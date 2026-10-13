import prepareTestDatabase from './global-setup';
void prepareTestDatabase().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
