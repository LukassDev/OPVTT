import { app } from "electron";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { BoardState, RoomContent, RoomSummary } from "../shared/types";

const APPLICATION_ID = 1330665044;
const SCHEMA_VERSION = 1;

const EMPTY_BOARD: BoardState = {
  map: "",
  tokens: [],
  fog: [],
  announcement: "",
  mapLayers: [],
};

const EMPTY_CONTENT: RoomContent = {
  scenes: [],
  sheets: [],
  assets: [],
  notes: "",
  maps: [],
};

let sqlPromise: Promise<SqlJsStatic> | undefined;

export class RoomDatabase {
  readonly directory: string;
  private activePath = "";
  private connection!: Database;
  private readonly SQL: SqlJsStatic;

  private constructor(SQL: SqlJsStatic) {
    this.SQL = SQL;
    this.directory = app.isPackaged
      ? app.getPath("userData")
      : path.join(app.getAppPath(), "dados");
    mkdirSync(this.directory, { recursive: true });
  }

  static async open(): Promise<RoomDatabase> {
    const SQL = await (sqlPromise ??= initSqlJs({
      locateFile: (filename) => path.join(app.getAppPath(), "node_modules", "sql.js", "dist", filename),
    }));
    const database = new RoomDatabase(SQL);
    database.openOrCreate();
    return database;
  }

  private openOrCreate(): void {
    const pointer = path.join(this.directory, "active-db.txt");
    if (existsSync(pointer)) {
      const filename = readFileSync(pointer, "utf8").trim();
      const candidate = path.resolve(this.directory, filename);
      if (path.dirname(candidate) !== path.resolve(this.directory)) {
        throw new Error("Invalid active database selection.");
      }
      this.select(candidate);
      return;
    }

    const files = this.databaseFiles();
    if (files.length > 1) {
      throw new Error("Multiple data files found. Choose a data file to open.");
    }
    if (files.length === 1) {
      this.select(files[0]);
      return;
    }
    this.createNew();
  }

  private databaseFiles(): string[] {
    return readdirSync(this.directory)
      .filter((name) => name.toLowerCase().endsWith(".db"))
      .map((name) => path.join(this.directory, name));
  }

  private createNew(): void {
    this.connection?.close();
    let filename = path.join(this.directory, "opvtt.db");
    if (existsSync(filename)) filename = path.join(this.directory, `opvtt-${randomUUID()}.db`);
    const database = new this.SQL.Database();
    database.run(`PRAGMA application_id = ${APPLICATION_ID}`);
    database.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    database.run(`
      CREATE TABLE rooms (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL CHECK(length(trim(name)) > 0),
        description TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
    `);
    this.connection = database;
    this.activePath = path.resolve(filename);
    this.persist();
    this.writePointer(filename);
  }

  createDatabase(): RoomSummary[] {
    this.createNew();
    return this.listRooms();
  }

  private select(filename: string): void {
    RoomDatabase.validateWithSql(this.SQL, filename);
    this.connection?.close();
    this.activePath = path.resolve(filename);
    this.connection = new this.SQL.Database(readFileSync(this.activePath));
    this.connection.run("PRAGMA foreign_keys = ON");
    this.writePointer(filename);
  }

  static async validate(filename: string): Promise<void> {
    if (!sqlPromise) {
      sqlPromise = initSqlJs({
        locateFile: (name) => path.join(app.getAppPath(), "node_modules", "sql.js", "dist", name),
      });
    }
    RoomDatabase.validateWithSql(await sqlPromise, filename);
  }

  private static validateWithSql(SQL: SqlJsStatic, filename: string): void {
    if (!existsSync(filename)) throw new Error("The selected data file does not exist.");
    let db: Database | undefined;
    try {
      db = new SQL.Database(readFileSync(filename));
      if (db.exec("PRAGMA integrity_check")[0]?.values[0]?.[0] !== "ok") {
        throw new Error("The database is damaged.");
      }
      if (Number(db.exec("PRAGMA application_id")[0]?.values[0]?.[0]) !== APPLICATION_ID) {
        throw new Error("This is not an OPVTT data file.");
      }
      if (Number(db.exec("PRAGMA user_version")[0]?.values[0]?.[0]) !== SCHEMA_VERSION) {
        throw new Error("Unsupported database version. Original file preserved.");
      }
      const tables = new Set(
        db.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]?.values.map((row) => String(row[0])) ?? [],
      );
      if (!tables.has("rooms") || !tables.has("settings")) {
        throw new Error("Required OPVTT tables are missing.");
      }
      const roomFields = db.exec("PRAGMA table_info(rooms)")[0]?.values ?? [];
      const settingFields = db.exec("PRAGMA table_info(settings)")[0]?.values ?? [];
      const checks: Array<[unknown[][], Array<[string, string, number, number]>]> = [
        [roomFields, [["id", "TEXT", 1, 1], ["name", "TEXT", 1, 0], ["description", "TEXT", 1, 0]]],
        [settingFields, [["key", "TEXT", 1, 1], ["value", "TEXT", 1, 0]]],
      ];
      for (const [fields, required] of checks) {
        for (const [name, type, notNull, primaryKey] of required) {
          const field = fields.find((item) => item[1] === name);
          if (!field || String(field[2]).toUpperCase() !== type || Number(field[3]) !== notNull || Number(field[5]) !== primaryKey) {
            throw new Error(`Unsupported database structure in ${name}.`);
          }
        }
      }
      const invalidRoom = db.exec(
        "SELECT 1 FROM rooms WHERE id IS NULL OR trim(id) = '' OR name IS NULL OR trim(name) = '' OR description IS NULL LIMIT 1",
      )[0]?.values[0];
      if (invalidRoom) throw new Error("Invalid room records.");
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.startsWith("This is not") ||
          error.message.startsWith("Unsupported database") ||
          error.message.startsWith("The database") ||
          error.message.startsWith("Required") ||
          error.message.startsWith("Invalid room"))
      ) {
        throw error;
      }
      throw new Error("The database is damaged or has an unsupported structure.", { cause: error });
    } finally {
      db?.close();
    }
  }

  listRooms(): RoomSummary[] {
    return this.rows<RoomSummary>("SELECT id, name, description FROM rooms ORDER BY name COLLATE NOCASE");
  }

  createRoom(name: string, description: string): RoomSummary[] {
    const normalized = name.trim();
    if (!normalized) throw new Error("Room name is required.");
    this.connection.run("INSERT INTO rooms (id, name, description) VALUES (?, ?, ?)", [randomUUID(), normalized, description]);
    this.persist();
    return this.listRooms();
  }

  updateRoom(id: string, name: string, description: string): RoomSummary[] {
    const normalized = name.trim();
    if (!normalized) throw new Error("Room name is required.");
    this.connection.run("UPDATE rooms SET name = ?, description = ? WHERE id = ?", [normalized, description, id]);
    if (this.connection.getRowsModified() !== 1) throw new Error("Room no longer exists.");
    this.persist();
    return this.listRooms();
  }

  deleteRoom(id: string): RoomSummary[] {
    this.backup();
    this.connection.run("BEGIN IMMEDIATE");
    try {
      this.connection.run("DELETE FROM rooms WHERE id = ?", [id]);
      this.connection.run("DELETE FROM settings WHERE key LIKE ?", [`%:${id}`]);
      this.connection.run("COMMIT");
    } catch (error) {
      this.connection.run("ROLLBACK");
      throw error;
    }
    this.persist();
    return this.listRooms();
  }

  getBoard(id: string): BoardState {
    return this.readDocument(`board.v1:${id}`, EMPTY_BOARD);
  }

  saveBoard(id: string, board: BoardState): void {
    this.writeDocument(`board.v1:${id}`, board);
  }

  getContent(id: string): RoomContent {
    return this.readDocument(`room.v1:${id}`, EMPTY_CONTENT);
  }

  saveContent(id: string, content: RoomContent): void {
    this.writeDocument(`room.v1:${id}`, content);
  }

  getSetting<T>(key: string, fallback: T): T {
    return this.readDocument(key, fallback);
  }

  setSetting<T>(key: string, value: T): void {
    this.writeDocument(key, value);
  }

  backup(): string {
    const destinationDir = path.join(this.directory, "backups");
    mkdirSync(destinationDir, { recursive: true });
    const destination = path.join(destinationDir, `backup-${randomUUID()}.db`);
    this.persist();
    writeFileSync(destination, this.connection.export());
    RoomDatabase.validateWithSql(this.SQL, destination);
    return destination;
  }

  importDatabase(source: string): RoomSummary[] {
    RoomDatabase.validateWithSql(this.SQL, source);
    const filename = path.join(this.directory, `imported-${randomUUID()}.db`);
    writeFileSync(filename, readFileSync(source));
    this.select(filename);
    return this.listRooms();
  }

  activeDatabase(): string {
    return this.activePath;
  }

  close(): void {
    this.connection?.close();
  }

  private readDocument<T>(key: string, fallback: T): T {
    const value = this.connection.exec("SELECT value FROM settings WHERE key = ?", [key])[0]?.values[0]?.[0];
    if (value === undefined) return structuredClone(fallback);
    try {
      return JSON.parse(String(value)) as T;
    } catch (error) {
      throw new Error(`Saved data is invalid: ${key}`, { cause: error });
    }
  }

  private writeDocument(key: string, value: unknown): void {
    const json = JSON.stringify(value);
    this.connection.run(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, json],
    );
    this.persist();
  }

  private rows<T>(sql: string): T[] {
    const result = this.connection.exec(sql)[0];
    if (!result) return [];
    return result.values.map((values) =>
      Object.fromEntries(result.columns.map((column, index) => [column, values[index]])),
    ) as T[];
  }

  private persist(): void {
    if (!this.activePath) return;
    const temporary = `${this.activePath}.${randomUUID()}.tmp`;
    writeFileSync(temporary, this.connection.export());
    renameSync(temporary, this.activePath);
  }

  private writePointer(filename: string): void {
    writeFileSync(path.join(this.directory, "active-db.txt"), path.basename(filename), "utf8");
  }
}
