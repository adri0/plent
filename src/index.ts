export const BOT_NAME = 'Ent';

export function main(): void {
  console.log(`${BOT_NAME} starting`);
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  main();
}
