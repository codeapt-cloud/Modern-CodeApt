/**
 * Shared framework-agnostic helper types (no Mongoose / Express coupling).
 */
import type { Role } from "./enums.js";

/** A MongoDB ObjectId serialized as a string across the API boundary. */
export type Id = string;

/** Standard pagination query accepted by list endpoints. */
export interface PaginationQuery {
  page: number;
  limit: number;
}

/** Standard paginated response envelope. */
export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** Authenticated principal attached to requests after auth (later step). */
export interface AuthPrincipal {
  userId: Id;
  role: Role;
}
