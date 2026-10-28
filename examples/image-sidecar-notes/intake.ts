// Intake: when an image enters the knowledge base, one vision request writes
// a text note about it, the sidecar `<image>.md`. This happens once per
// image. After that, a plain text search reaches the image's facts, and no
// question needs to send the image again.
import {
  createResponse,
  pickProvider,
  sumUsage,
  type Usage,
} from '#shared/llm.ts'
import { sidecarPath } from './base.ts'
import { type BaseImage, IMAGES } from './images.ts'

/** The same detail in intake and in view_image, so the image costs the same in both. */
export const DETAIL = 'high'

export const SIDECAR_INSTRUCTIONS = `You write a text note about one image in a team knowledge base. A text search (grep) will look for the image's facts in your note, so write down, as plain text, every label, name, number, date and decision the image shows, and what each one belongs to. Write Markdown: a "# " title, then short lines. Under 150 words. Do not add anything the image does not show.`

export interface Sidecar {
  image: string
  path: string
  text: string
  model: string
  usage: Usage
  ms: number
  request: unknown
  response: unknown
}

export interface Intake {
  sidecars: Sidecar[]
  usage: Usage
  /** Wall time of the intake: the requests run at the same time. */
  ms: number
  model: string
}

/** Replaces each inline image in a shown request with a short stand-in, so the JSON stays readable. */
export function shortenImages(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value), (_key, v) =>
    typeof v === 'string' && v.startsWith('data:image/')
      ? `${v.slice(0, 40)}… (${v.length} characters)`
      : v,
  )
}

async function writeSidecar(
  image: BaseImage,
  provider: string,
  model?: string,
): Promise<Sidecar> {
  const result = await createResponse(
    {
      model,
      instructions: SIDECAR_INSTRUCTIONS,
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: `Image file: ${image.path}` },
            { type: 'input_image', image_url: image.url, detail: DETAIL },
          ],
        },
      ],
      reasoning: { effort: 'low' },
      max_output_tokens: 2_000,
    },
    { provider },
  )

  // The last line links the note to its image, so a search for the file name finds it too.
  const text = `${result.text.trim()}\n\nImage: ${image.path}`

  return {
    image: image.path,
    path: sidecarPath(image.path),
    text,
    model: result.model,
    usage: result.usage,
    ms: result.ms,
    request: shortenImages(result.request),
    response: result.response,
  }
}

/** One vision request per image, all at the same time. */
export async function intake(
  options: { provider?: string; model?: string } = {},
): Promise<Intake> {
  // Check the key once, before any request.
  const provider = pickProvider(options.provider)
  const started = performance.now()
  const sidecars = await Promise.all(
    IMAGES.map((image) => writeSidecar(image, provider, options.model)),
  )

  return {
    sidecars,
    usage: sumUsage(sidecars.map((s) => s.usage)),
    ms: Math.round(performance.now() - started),
    model: sidecars[0].model,
  }
}

/** The sidecar texts by image path: what makeBase() takes. */
export const sidecarTexts = (done: Intake) =>
  Object.fromEntries(done.sidecars.map((s) => [s.image, s.text]))
