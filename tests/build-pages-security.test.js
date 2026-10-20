const assert = require("node:assert/strict");
const test = require("node:test");
const { renderJsonLd } = require("../scripts/build-pages");

test("JSON-LD cannot be closed by catalogue text", () => {
  const title = '</script><script>alert("catalogue XSS")</script>';
  const html = renderJsonLd({ "@type": "MusicPlaylist", name: title });
  const match = html.match(/^<script type="application\/ld\+json">\n([\s\S]*)\n<\/script>$/);

  assert.ok(match, "one complete JSON-LD element is produced");
  assert.equal((html.match(/<\/script>/gi) || []).length, 1);
  assert.ok(!html.includes(title), "the raw closing tag must not reach HTML");
  assert.deepEqual(JSON.parse(match[1]), { "@type": "MusicPlaylist", name: title });
});
