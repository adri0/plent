import { DomainError } from '../domain/errors.ts';

// Short refs the model sees in place of UUIDs: p1, p2… for plants, n1, n2… for notes. A map
// lives for one agent call and holds only the household's own ids, so a ref can never reach
// another household's data.

export type RefKind = 'plant' | 'note';

const PREFIX: Record<RefKind, string> = { plant: 'p', note: 'n' };

export class RefMap {
  private readonly byId = new Map<string, string>();
  private readonly byRef = new Map<string, { kind: RefKind; id: string }>();
  private readonly counts: Record<RefKind, number> = { plant: 0, note: 0 };

  // The id's ref, numbered on first sight.
  add(kind: RefKind, id: string): string {
    const known = this.byId.get(id);
    if (known !== undefined) return known;
    this.counts[kind] += 1;
    const ref = `${PREFIX[kind]}${String(this.counts[kind])}`;
    this.byId.set(id, ref);
    this.byRef.set(ref, { kind, id });
    return ref;
  }

  refOf(id: string): string | undefined {
    return this.byId.get(id);
  }

  // The id behind a ref the model gave. Case and stray brackets are forgiven ("[P2]").
  resolve(kind: RefKind, ref: string): string {
    const key = ref
      .trim()
      .toLowerCase()
      .replace(/^\[|\]$/g, '');
    const entry = this.byRef.get(key);
    if (entry?.kind !== kind) {
      const example = kind === 'plant' ? 'p1' : 'n1';
      throw new DomainError(
        'not_found',
        `unknown ${kind} ref "${ref}": use a ref like ${example} from the context, or ask which ${kind} is meant`,
      );
    }
    return entry.id;
  }
}
