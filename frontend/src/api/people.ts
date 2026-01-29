import { api } from "./client";
import type { Person } from "../types/people";

export function getPeople() {
  return api<Person[]>("/people");
}

export function createPerson(data: Omit<Person, "personID">) {
  return api<Person>("/people", { method: "POST", body: data });
}

export function deletePerson(personID: number) {
  return api<void>(`/people/${personID}`, { method: "DELETE" });
}

export function updatePerson(personID: number, patch: Partial<Person>) {
  return api<Person>(`/people/${personID}`, { method: "PATCH", body: patch });
}
