// T-DG6-DO-A2 (D-199): `image-size` is overridden from 1.2.1 to 2.x (pnpm `overrides` in the root package.json) to
// clear GHSA-5p2g-fcmc-qvqq and GHSA-w3rx-r6r6-pgpr. pptxgenjs@4.0.1 declares `image-size ^1.2.1`, so this test proves
// that the pptxgenjs build the product ships still writes a valid presentation that embeds a PNG and a JPEG under the
// override: both media parts are present byte for byte, typed in [Content_Types].xml, referenced from the slide's
// relationships and `<a:blip>`, and every XML part is well-formed. The images are generated here (synthetic: a 3x2 PNG
// and an 8x8 grey baseline JPEG); no file fixture.
import { crc32, deflateSync } from "node:zlib";
import JSZip from "jszip";
import pptxModule from "pptxgenjs";
import { describe, expect, it } from "vitest";
import { malformedParts } from "./ooxml-read.ts";

type Pptx = typeof pptxModule.default;
const PptxGenJS = ((pptxModule as unknown as { default?: Pptx }).default ?? (pptxModule as unknown as Pptx)) as Pptx;

const u32 = (n: number) => Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);

/** A truecolour PNG (8-bit RGB, no interlace) of `w` x `h` pixels, every chunk with its CRC (PNG spec §5). */
function png(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    return Buffer.concat([u32(data.length), td, u32(crc32(td))]);
  };
  const ihdr = Buffer.concat([u32(w), u32(h), Buffer.from([8, 2, 0, 0, 0])]);
  const rows: number[] = [];
  for (let y = 0; y < h; y++) {
    rows.push(0); // filter type None
    for (let x = 0; x < w; x++) rows.push(0x00, 0x78, 0xff); // the provisional brand token, as a pixel colour
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * A baseline (SOF0) greyscale JPEG of one 8x8 block, mid grey (ITU-T T.81): one quantisation table of 1s, a DC
 * Huffman table whose only code ("0", length 1) is category 0 and an AC table whose only code ("0") is EOB. The scan
 * is DC difference 0 then EOB, i.e. the bits "00", padded with 1s to the byte 0x3F.
 */
function jpeg(): Buffer {
  const seg = (marker: number, body: number[]) =>
    Buffer.from([0xff, marker, ((body.length + 2) >> 8) & 255, (body.length + 2) & 255, ...body]);
  const huff = (tableClassAndId: number) => [tableClassAndId, 1, ...new Array<number>(15).fill(0), 0x00];
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), // SOI
    seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]), // APP0 JFIF 1.1, aspect 1:1
    seg(0xdb, [0x00, ...new Array<number>(64).fill(1)]), // DQT table 0
    seg(0xc0, [8, 0, 8, 0, 8, 1, 1, 0x11, 0]), // SOF0: 8-bit, 8x8, 1 component, 1x1 sampling, table 0
    seg(0xc4, huff(0x00)), // DHT DC 0
    seg(0xc4, huff(0x10)), // DHT AC 0
    seg(0xda, [1, 1, 0x00, 0, 63, 0]), // SOS: component 1 uses DC 0 / AC 0; Ss 0, Se 63, Ah/Al 0
    Buffer.from([0x3f]), // entropy-coded data
    Buffer.from([0xff, 0xd9]), // EOI
  ]);
}

describe("PPTX export with embedded images (pptxgenjs with image-size overridden to 2.x)", () => {
  it("embeds a PNG and a JPEG: media parts byte-identical, typed, referenced, and every XML part well-formed", async () => {
    const pngBytes = png(3, 2);
    const jpegBytes = jpeg();
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_16x9";
    const slide = pptx.addSlide();
    slide.addText("Synthetic slide with two images", { x: 0.4, y: 0.3, w: 9, h: 0.5, fontSize: 14 });
    slide.addImage({ data: `image/png;base64,${pngBytes.toString("base64")}`, x: 0.5, y: 1, w: 3, h: 2 });
    slide.addImage({ data: `image/jpeg;base64,${jpegBytes.toString("base64")}`, x: 5, y: 1, w: 2, h: 2 });

    const out = await pptx.write({ outputType: "STREAM", compression: true });
    expect(out).toBeInstanceOf(Uint8Array);
    const bytes = out as Uint8Array;
    expect(await malformedParts(bytes)).toEqual([]);

    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files);
    const media = names.filter((n) => n.startsWith("ppt/media/")).sort();
    const pngPart = media.find((n) => n.endsWith(".png"));
    const jpegPart = media.find((n) => /\.jpe?g$/.test(n));
    expect(pngPart, `media parts: ${media.join(", ")}`).toBeDefined();
    expect(jpegPart, `media parts: ${media.join(", ")}`).toBeDefined();
    expect(Buffer.from(await zip.file(pngPart!)!.async("uint8array")).equals(pngBytes)).toBe(true);
    expect(Buffer.from(await zip.file(jpegPart!)!.async("uint8array")).equals(jpegBytes)).toBe(true);

    const types = await zip.file("[Content_Types].xml")!.async("string");
    expect(types).toMatch(/<Default Extension="png" ContentType="image\/png"\s*\/>/);
    expect(types).toMatch(/<Default Extension="jpe?g" ContentType="image\/jpeg"\s*\/>/);

    const rels = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");
    const target = (part: string) => `../media/${part.slice("ppt/media/".length)}`;
    const relId = (part: string) => {
      const m = new RegExp(`<Relationship Id="(rId\\d+)"[^>]*Target="${target(part).replace(/\./g, "\\.")}"`).exec(
        rels,
      );
      return m?.[1];
    };
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    for (const part of [pngPart!, jpegPart!]) {
      const id = relId(part);
      expect(id, `relationship for ${part}`).toBeDefined();
      expect(slideXml).toContain(`<a:blip r:embed="${id}"`);
    }
  });
});
