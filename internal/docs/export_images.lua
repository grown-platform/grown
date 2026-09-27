-- export_images.lua: pandoc filter for every Docs export (see
-- export_images.go). The server prepends
--   local GROWN_INLINE = <bool>
--   local GROWN_IMAGES = { ["grown-img-1.png"] = { path = ..., mime = ... } }
-- listing the pictures it resolved and wrote to the conversion's temp dir.
--
-- pandoc runs with --sandbox, so it can't read these files itself. This
-- filter reads exactly the listed paths and puts them in the mediabag
-- (GROWN_INLINE, for Markdown: the file holds a data: URL that becomes the
-- src). Every other Image, whatever its src, is replaced by its alt text, so
-- nothing in the posted HTML can name a file or URL for pandoc to embed.

function Image(el)
  local m = GROWN_IMAGES[el.src]
  if m == nil then
    return el.caption
  end
  local fh = io.open(m.path, "rb")
  if fh == nil then
    return el.caption
  end
  local data = fh:read("a")
  fh:close()
  if GROWN_INLINE then
    el.src = data
  else
    pandoc.mediabag.insert(el.src, m.mime, data)
  end
  return el
end
