import { setFontCss } from '@mesa/art';
import caveatUrl from '@fontsource/caveat/files/caveat-latin-700-normal.woff2?url';
import patrickUrl from '@fontsource/patrick-hand/files/patrick-hand-latin-400-normal.woff2?url';

/** Embebe Caveat / Patrick Hand como data-URI en los SVG (en <img> no se heredan las fuentes de la página). */
let loading: Promise<void> | null = null;

export function loadArtFonts(): Promise<void> {
  return (loading ??= (async () => {
    const toData = async (url: string) => {
      const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return `data:font/woff2;base64,${btoa(bin)}`;
    };
    try {
      const [c, p] = await Promise.all([toData(caveatUrl), toData(patrickUrl)]);
      setFontCss(`@font-face{font-family:'Caveat';font-weight:700;src:url(${c}) format('woff2');}@font-face{font-family:'Patrick Hand';font-weight:400;src:url(${p}) format('woff2');}`);
    } catch {
      /* sin fuentes: los SVG caen a cursive */
    }
  })());
}
