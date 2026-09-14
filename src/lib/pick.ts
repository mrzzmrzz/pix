/** One of a fixed set. `random` is injected by tests so nothing has to reach
 *  for a global seed. */
export function pick<T>(items: readonly T[], random: () => number = Math.random): T {
  return items[Math.floor(random() * items.length)] ?? items[0]!
}

/** The same list starting somewhere else, so two turns in a row do not open on
 *  the same face. */
export function rotate<T>(items: readonly T[], by: number): T[] {
  const offset = ((by % items.length) + items.length) % items.length

  return [...items.slice(offset), ...items.slice(0, offset)]
}
