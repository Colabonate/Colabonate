// Tag helpers shared by event schemas and consumers (ADR-150).

export type NostrTag = string[]

/** First tag with the given name, or undefined. */
export function findTag(tags: NostrTag[], name: string): NostrTag | undefined {
  return tags.find(t => t[0] === name)
}

/** True if every required tag name is present at least once (existential check). */
export function hasRequiredTags(tags: NostrTag[], ...names: string[]): boolean {
  return names.every(name => tags.some(t => t[0] === name))
}
