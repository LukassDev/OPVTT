export interface RoomSummary {
  id: string;
  name: string;
  description: string;
}

export interface Token {
  id: string;
  name: string;
  x: number;
  y: number;
  visible: boolean;
  imagePath: string;
  ratio: number;
}

export interface MapLayer {
  id: string;
  name: string;
  path: string;
  visible: boolean;
}

export interface FogArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoardState {
  map: string;
  tokens: Token[];
  fog: FogArea[];
  announcement: string;
  mapLayers: MapLayer[];
  fade?: number;
  blackout?: boolean;
  previouslyVisibleTokenIds?: string[];
  presentation?: {
    source: string;
    url: string;
    playing: boolean;
    loop?: boolean;
  };
}

export interface BoardViewport {
  zoom: number;
  /** Pan offsets normalized to the board frame's width and height. */
  pan: { x: number; y: number };
}

export interface PreviewBoardUpdate {
  roomId: string;
  board: BoardState;
  viewport: BoardViewport;
}

export interface CharacterSheet {
  id: string;
  name: string;
  kind: string;
  hp: number;
  maxHp: number;
  attributes: string;
  inventory: string;
  abilities: string;
  notes: string;
  imagePath: string;
  tokenRatio: number;
}

export interface LibraryAsset {
  id: string;
  name: string;
  path: string;
  kind: string;
}

export interface TileMap {
  id: string;
  name: string;
  cells: string[];
}

export interface RoomContent {
  scenes: Array<{ id: string; name: string; board: BoardState }>;
  sheets: CharacterSheet[];
  assets: LibraryAsset[];
  notes: string;
  maps: TileMap[];
}

export interface AppSettings {
  theme: "dark" | "light";
  display: string;
  fullscreen: boolean;
  mainFullscreen: boolean;
  quality: "FULL_HD" | "HD";
  port: number;
}

export interface DisplayOption {
  id: string;
  label: string;
}

export interface OpvttApi {
  rooms: {
    list: () => Promise<RoomSummary[]>;
    create: (name: string, description: string) => Promise<RoomSummary[]>;
    update: (id: string, name: string, description: string) => Promise<RoomSummary[]>;
    delete: (id: string) => Promise<RoomSummary[]>;
    board: (id: string) => Promise<BoardState>;
    saveBoard: (id: string, board: BoardState) => Promise<void>;
    content: (id: string) => Promise<RoomContent>;
    saveContent: (id: string, content: RoomContent) => Promise<void>;
  };
  settings: {
    get: () => Promise<AppSettings>;
    set: (settings: Partial<AppSettings>) => Promise<AppSettings>;
    activeDatabase: () => Promise<string>;
    importDatabase: () => Promise<RoomSummary[] | null>;
    backup: () => Promise<string>;
    createDatabase: () => Promise<RoomSummary[]>;
  };
  files: {
    import: (kind: "images" | "videos" | "audio") => Promise<string[]>;
    choose: (kind: "images" | "videos" | "audio") => Promise<string[]>;
    assetUrl: (filename: string) => Promise<string>;
    removeAsset: (filename: string) => Promise<void>;
  };
  media: {
    resolve: (link: string, audioOnly: boolean) => Promise<{ url: string; title: string }>;
  };
  windows: {
    displays: () => Promise<DisplayOption[]>;
    onMainFullscreen: (callback: (fullscreen: boolean) => void) => () => void;
    onPreviewBoard: (callback: (update: PreviewBoardUpdate) => void) => () => void;
    updatePreviewBoard: (roomId: string, board: BoardState, viewport: BoardViewport) => Promise<void>;
    openPublic: (roomId: string) => Promise<void>;
    closePublic: () => Promise<void>;
    toggleFullscreen: () => Promise<void>;
  };
  broadcast: {
    start: (port: number) => Promise<{ port: number; addresses: string[]; secret: string }>;
    stop: () => Promise<void>;
    status: () => Promise<{ live: boolean; port: number | null; viewers: number }>;
    publish: (secret: string, active: boolean) => Promise<void>;
    onViewerCount: (callback: (count: number) => void) => () => void;
    onBroadcastStopped: (callback: () => void) => () => void;
  };
  onWindowClose: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    opvtt: OpvttApi;
  }
}
