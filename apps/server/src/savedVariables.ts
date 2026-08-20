/**
 * Reads simc exports out of the addon's SavedVariables file.
 *
 * Deliberately not a Lua parser. It scans for the `["simc"] = "..."` fields our
 * own addon writes and unescapes them. WoW's serialiser escapes backslashes,
 * double quotes and newlines, so honouring those is sufficient -- and a
 * targeted scanner degrades to "found nothing" rather than throwing when the
 * file is truncated by a client crash mid-write, which is a real failure mode
 * for SavedVariables.
 *
 * Kept free of imports so it can be tested without booting the server.
 */

const NEEDLE = '["simc"] = "';

export function extractSimcExports(lua: string): string[] {
  const out: string[] = [];
  let index = lua.indexOf(NEEDLE);

  while (index !== -1) {
    let i = index + NEEDLE.length;
    let value = '';
    let closed = false;

    while (i < lua.length) {
      const ch = lua[i]!;

      if (ch === '\\') {
        const next = lua[i + 1];
        if (next === undefined) {
          // Trailing backslash: the file was cut off mid-escape.
          i += 1;
          break;
        }
        if (next === 'n') value += '\n';
        else if (next === 't') value += '\t';
        else if (next === 'r') value += '\r';
        else value += next; // covers \\ and \" and anything unexpected
        i += 2;
        continue;
      }

      if (ch === '"') {
        closed = true;
        i += 1;
        break;
      }

      value += ch;
      i += 1;
    }

    // An unterminated string means a truncated file; drop it rather than
    // importing a half-written profile.
    if (closed && value.trim()) out.push(value);

    index = lua.indexOf(NEEDLE, i);
  }

  return out;
}
