import { ulid } from 'ulid';

export function newUpdateId() {
  return `U_${ulid()}`;
}

export function newOutingId() {
  return `O_${ulid()}`;
}
