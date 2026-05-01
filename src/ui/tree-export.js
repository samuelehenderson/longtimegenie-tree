// Export the current tree-view DOM as a PNG image.
//
// Approach: wrap a clone of the rendered DOM in an SVG <foreignObject>,
// embed all the page's CSS rules so the wrapped HTML still has the
// brand styling, draw that SVG into a 2× canvas, and export as PNG.
//
// No external dependencies — modern Chrome / Edge / Firefox handle
// foreignObject rasterization fine. Safari has historical quirks with
// foreignObject + canvas rendering; the export still produces a file,
// it may just lose some styling polish there. Worth knowing, not
// worth taking on a hefty dep for v1.

const PADDING = 24;
const FOOTER_HEIGHT = 38;
const SCALE = 2; // retina-quality
const BACKGROUND = '#faf6ed';

export async function exportTreeAsPng(sourceEl, suggestedName = 'tree.png', meta = {}) {
  if (!sourceEl) throw new Error('exportTreeAsPng: no source element.');

  const w = Math.max(sourceEl.scrollWidth, sourceEl.offsetWidth);
  const h = Math.max(sourceEl.scrollHeight, sourceEl.offsetHeight);
  if (w === 0 || h === 0) throw new Error('Tree view has no content to export.');

  const totalW = w + PADDING * 2;
  const totalH = h + PADDING * 2 + FOOTER_HEIGHT;

  const css = collectPageCss();
  const innerHtml = sourceEl.outerHTML;
  const footerHtml = renderFooter(meta);

  // The wrapper carries the cream brand background, padding, and a
  // brand footer so the saved image stands on its own as a deliverable.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">
  <foreignObject x="0" y="0" width="${totalW}" height="${totalH}">
    <div xmlns="http://www.w3.org/1999/xhtml" style="background:${BACKGROUND};width:${totalW}px;height:${totalH}px;padding:${PADDING}px ${PADDING}px 0;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,system-ui,sans-serif;color:#2a2520;display:flex;flex-direction:column;">
      <style><![CDATA[${css}]]></style>
      <div style="flex:1;min-height:0;">${innerHtml}</div>
      ${footerHtml}
    </div>
  </foreignObject>
</svg>`;

  const blob = await rasterizeSvg(svg, totalW, totalH);
  downloadBlob(suggestedName, blob);
}

function renderFooter({ focusName, sourceLabel } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  // Right-side caption: focused person + date, falling back to date alone.
  const rightParts = [];
  if (focusName) rightParts.push(escapeXml(focusName));
  if (sourceLabel) rightParts.push(escapeXml(sourceLabel));
  rightParts.push(today);
  const rightCaption = rightParts.join(' · ');

  return `
    <div style="height:${FOOTER_HEIGHT}px;display:flex;align-items:center;justify-content:space-between;padding:0 4px;border-top:1px solid #e8dfc9;margin-top:14px;font-size:12px;color:#6b6357;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:20px;color:#2d5016;line-height:1;">𓊝</span>
        <span style="font-family:'Cormorant Garamond','Iowan Old Style',Georgia,serif;font-weight:600;font-size:14px;color:#1f3810;letter-spacing:0.02em;">LongTimeGenie Tree</span>
        <span style="color:#a85b3f;">·</span>
        <span style="font-size:11px;">tree.longtimegenie.com</span>
      </div>
      <div style="font-size:11px;color:#6b6357;">${rightCaption}</div>
    </div>
  `;
}

function escapeXml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

function rasterizeSvg(svgString, w, h) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = w * SCALE;
        canvas.height = h * SCALE;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = BACKGROUND;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.scale(SCALE, SCALE);
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((out) => {
          URL.revokeObjectURL(url);
          if (!out) reject(new Error('Canvas toBlob returned null.'));
          else resolve(out);
        }, 'image/png');
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't rasterize the tree. Some browsers (notably older Safari) have foreignObject quirks."));
    };
    img.src = url;
  });
}

function collectPageCss() {
  let result = '';
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // CORS-blocked sheet (e.g. fonts.googleapis.com); skip it
    }
    if (!rules) continue;
    for (const rule of rules) {
      result += rule.cssText + '\n';
    }
  }
  return result;
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function suggestedTreeFilename(focusPersonName) {
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = (focusPersonName || 'tree')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'tree';
  return `tree-${slug}-${stamp}.png`;
}
