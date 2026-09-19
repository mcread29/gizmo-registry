export interface ConsoleEntry {
  seq?: number;
  timestamp?: string;
  level: "log" | "warn" | "error";
  message: string;
  stackTrace?: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface ConsoleCounts {
  logs: number;
  warnings: number;
  errors: number;
}
