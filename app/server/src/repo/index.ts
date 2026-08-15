import { env } from "../config.js";
import { RepositorioDynamo } from "./dynamo.js";
import { RepositorioSqlite } from "./sqlite.js";
import type { Repositorio } from "./types.js";

export const repo: Repositorio = env.dbDriver === "dynamodb" ? new RepositorioDynamo() : new RepositorioSqlite();

export type * from "./types.js";
