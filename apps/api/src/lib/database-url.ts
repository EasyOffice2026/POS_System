// Whether a database address points at this computer. The demo seed adds accounts with a public
// password, so it only runs against a database like that, unless somebody says otherwise.
export function isLocalDatabase(databaseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    return false;
  }

  // No host means a connection through a socket on this computer.
  return (
    host === '' || host === 'localhost' || host === '[::1]' || /^127(\.\d{1,3}){3}$/.test(host)
  );
}
