# Optional asset reuse

The library holds reusable local media or code bundles. Use an existing asset when it fits; agents can
create their own files freely. Library publication is optional and does not gate film review or delivery.

```bash
npm run video -- library-search --query "<asset>"
npm run video -- library-info --item <id@version>
npm run video -- library-use --item <id@version> --job jobs/<slug>
npm run video -- save --job jobs/<slug> --file assets/<file> --title "<description>" --tags "<search terms>"
```

Search reads metadata. Use copies a specific version into `assets/library/` and records file hashes.
It does not insert scenes or execute scripts. Reference copied assets from the native composition or
pipeline soundtrack. Keep frozen copies intact; make a separately named derivative when adapting them.

## Bundles

`library/<id>/<major.minor.patch>/artifact.json` declares schemaVersion 1, id, version, kind, title,
description, tags, entry, files and usage. Optional parameters and cueSlots document a reusable API.
All declared files stay inside the bundle. `library-add --source <job candidate folder>` validates and
publishes a version; existing versions cannot be overwritten. Sources/licences should travel with media.

Finished thumbnail sets are archived by `thumbnail-choose` under `library/thumbnails/<slug>/`, preserving
the video's dimensions, variants and recorded selection. The renderer's own generated files are not
reusable creative assets and should not be published as such.
