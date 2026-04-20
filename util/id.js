import { ulid } from 'ulid';

export function newUpdateId() {
  return `U_${ulid()}`;
}
