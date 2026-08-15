import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { paths } from "../config.js";

let db: DatabaseSync | undefined;

export function getDb(): DatabaseSync {
  if (db) return db;

  fs.mkdirSync(path.dirname(paths.dbFile), { recursive: true });
  db = new DatabaseSync(paths.dbFile);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = OFF");

  const schema = fs.readFileSync(
    path.join(import.meta.dirname, "schema.sql"),
    "utf-8",
  );
  db.exec(schema);

  return db;
}
