// `prepare` hook: installs the git hooks in .husky/.
//
// Skips quietly where husky itself isn't installed — e.g. `npm ci` inside
// frontend/, which uses frontend/package-lock.json but still runs the root
// `prepare`, or a production install without devDependencies. Any other
// failure still fails the install.
try {
  const { default: husky } = await import('husky');
  const message = husky();
  if (message) console.log(message);
} catch (error) {
  if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  console.log('husky not installed; skipping git hook setup');
}
