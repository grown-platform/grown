-- import_sanitize.lua: pandoc filter applied to every document import.
--
-- Imported files are untrusted. Markdown/txt (and docx hyperlinks) can carry
-- raw HTML such as <script>, <iframe>, <style>, on* event handlers and
-- javascript: URLs straight through pandoc into the returned HTML. This filter
-- works on pandoc's AST, so it cannot be fooled by HTML tokenisation quirks:
--   * raw HTML blocks, and raw inline HTML other than bare formatting tags
--     (<u>, <sup>, ...), are dropped (their text never reaches the doc);
--   * link/image targets with script-capable schemes are blanked;
--   * attributes named on* are removed from every element that has any;
--   * pictures packed in the file (docx/odt/epub/rtf media, in pandoc's
--     mediabag) become data: URIs.
--
-- The filter embeds pictures itself instead of pandoc's --embed-resources:
-- in pandoc 3.1.13 (the production image's Alpine package) --embed-resources
-- ignores --sandbox and inlines any server file or URL an uploaded html/md
-- names (<img src="/etc/passwd">). Only mediabag entries are embedded here,
-- and a mediabag lookup never reads the filesystem or the network.

-- unsafe reports whether url may run script. data: is allowed only for
-- images (how imports embed media; an <img> never executes it); a data: link
-- (e.g. data:text/html) is refused.
local function unsafe(url, is_image)
  local u = url:gsub("[%s%c]", ""):lower()
  if u:match("^javascript:") or u:match("^vbscript:") then return true end
  if u:match("^data:") then
    return not (is_image and u:match("^data:image/"))
  end
  return false
end

local B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local enc = {}
for i = 0, 63 do enc[i] = B64:sub(i + 1, i + 1) end

local function base64(s)
  local out, n, len = {}, 0, #s
  for i = 1, len - 2, 3 do
    local a, b, c = s:byte(i, i + 2)
    local v = a << 16 | b << 8 | c
    n = n + 1
    out[n] = enc[v >> 18] .. enc[v >> 12 & 63] .. enc[v >> 6 & 63] .. enc[v & 63]
  end
  local rem = len % 3
  if rem == 1 then
    local v = s:byte(len) << 16
    out[n + 1] = enc[v >> 18] .. enc[v >> 12 & 63] .. "=="
  elseif rem == 2 then
    local a, b = s:byte(len - 1, len)
    local v = a << 16 | b << 8
    out[n + 1] = enc[v >> 18] .. enc[v >> 12 & 63] .. enc[v >> 6 & 63] .. "="
  end
  return table.concat(out)
end

-- embed returns a data: URI for a picture packed in the imported file, or nil.
local function embed(src)
  local mt, contents = pandoc.mediabag.lookup(src)
  if mt == nil or contents == nil then return nil end
  mt = mt:lower():gsub(";.*", "")
  if not mt:match("^image/[%w.+-]+$") then return nil end
  return "data:" .. mt .. ";base64," .. base64(contents)
end

local function clean_attr(el)
  if el.attributes then
    local drop = {}
    for k, _ in pairs(el.attributes) do
      if k:lower():match("^on") then drop[#drop + 1] = k end
    end
    for _, k in ipairs(drop) do el.attributes[k] = nil end
  end
  return el
end

-- Bare formatting tags with no attributes are kept: markdown has no syntax
-- for underline etc., so Grown's own gfm export writes <u>…</u> as raw HTML
-- and the round trip must not lose it. Anything else (any attribute, any
-- other tag, any block of HTML) is dropped.
local safe_tags = {
  u = true, sub = true, sup = true, mark = true, kbd = true, br = true,
  s = true, ins = true, del = true, small = true, b = true, i = true,
  em = true, strong = true,
}

local function safe_inline(text)
  local tag = text:match("^%s*</?%s*([%a]+)%s*/?%s*>%s*$")
  return tag ~= nil and safe_tags[tag:lower()] == true
end

local function is_html(el)
  return el.format:lower():match("^html") ~= nil
end

local function drop_block(el)
  if is_html(el) then return {} end
end

local function drop_inline(el)
  if is_html(el) and not safe_inline(el.text) then return {} end
end

return {{
  RawBlock = drop_block,
  RawInline = drop_inline,
  Link = function(el)
    if unsafe(el.target, false) then el.target = "" end
    return clean_attr(el)
  end,
  Image = function(el)
    local data = embed(el.src)
    if data then
      el.src = data
    elseif unsafe(el.src, true) then
      el.src = ""
    end
    return clean_attr(el)
  end,
  Div = clean_attr,
  Span = clean_attr,
  Header = clean_attr,
  CodeBlock = clean_attr,
  Code = clean_attr,
  Table = clean_attr,
  Figure = clean_attr,
}}
