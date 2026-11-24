import Link from "next/link";
import type { Metadata } from "next";
import GuidePage from "@/components/GuidePage";
import { pricing } from "@/config/pricing";
import { pageMetadata } from "@/libs/seo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMetadata(
  "/restore-old-video",
  "Restore Old Video | Keep Your Footage Looking Natural",
  "Restore old video with a careful preview: preserve the earliest digital copy, compare faces and movement, and keep the character of the original recording.",
);

export default function RestoreOldVideoPage() {
  return (
    <GuidePage>
      <p className="eyebrow">THE OLD FOLDER</p>
      <h1>Restore Old Video Without Losing Its Character</h1>
      <section aria-labelledby="archive-source">
        <h2 id="archive-source">Make an older video easier to watch again</h2>
        <p>An old family recording does not need to look newly filmed to be worth restoring. Its color, grain, and camera movement may be part of what you want to keep. The useful question is whether you can make faces, clothes, and familiar places easier to see without making them look artificial. Work from the earliest digital copy you can find, and keep that copy untouched.</p>
        <p>For a tape transfer or an older camera file, trim a representative scene before committing to a longer restoration. Look at moving hands and changing expressions as well as the background. Upscaling can make a small frame fit a modern display, but it cannot reliably reconstruct an unreadable sign or a face that was never in focus. Keep any version that looks natural, even if a little grain remains.</p>
        <p>Before uploading, collect the versions you already have. A file copied directly from an old camera may preserve more information than a version sent through a messaging app years later. Do not assume that the largest file is the earliest or best source: it may have been re-encoded at a larger frame size. Watch the same scene in each copy, check dates in your own archive where available, and label the source you choose so it is easy to find again.</p>
        <p>This site processes digital video files; it does not digitize a physical tape or repair a damaged recording medium. If you still have the tape and the transfer is incomplete, a better digital capture may help more than enhancing the current file. For an already digitized clip, read the <Link href="/video-upscaler">video upscaler input requirements</Link> and choose an output size that suits how your family will watch it, rather than stretching every source to the largest option.</p>
        <p>Prepare a short opening with a face, clothing texture, and some movement. The free account trial processes the first {pricing.free.maxDurationSec} seconds of an upload up to {pricing.free.maxUploadDurationSec} seconds long, at up to {pricing.free.maxOutputHeight}p with a watermark. It does not let you select a later enhancement start point. Only send material you are comfortable sharing with the processing providers. Avoid uploading sensitive family footage.</p>
        <p>Keep restoration choices separate from editorial changes. Save the original, the enhanced version, and your final edit under different names. If the source is an old mobile recording, the guide to <Link href="/fix-blurry-video">fixing blurry phone video</Link> helps distinguish grain from movement blur. If only a heavily shared copy survives, follow the <Link href="/fix-compressed-video">compressed-video workflow</Link>. When adding a newly generated transition to a family edit, check that shot with the <Link href="/upscale-ai-clips-for-4k-editing">AI clip editing guide</Link> rather than treating its invented details as part of the original recording.</p>
      </section>
      <section aria-labelledby="archive-causes">
        <h2 id="archive-causes">Why older recordings lose clarity</h2>
        <p>An older recording may begin with fewer captured pixels, limited low-light detail, or an imperfect transfer. Later resizing and lossy exports can remove additional information. Grain, blur, and compression artifacts may therefore coexist in the same frame. As the homepage FAQ explains, a larger output cannot recover every detail missing from the source. Noise reduction may make the image easier to watch, but it can also smooth meaningful texture. There is no automatic setting that can know which softness belongs to the recording and which detail you hoped was still there.</p>
      </section>
      <section aria-labelledby="archive-comparison">
        <h2 id="archive-comparison">What a useful restoration looks like</h2>
        <p>Use the <Link href="/#upload">homepage preview</Link> to compare faces during a turn, fabric during movement, and quiet areas such as a wall. A useful change may make an outline easier to follow without making the person look different. Pause to inspect texture, then resume playback to check that it remains stable. The goal is a more comfortable viewing copy, not a new-looking replacement for the archive. If the output erases character, creates false edges, or changes an expression, keep the source and use the more restrained version in your edit.</p>
      </section>
    </GuidePage>
  );
}
