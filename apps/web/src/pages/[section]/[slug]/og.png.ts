import type { APIRoute, GetStaticPaths } from 'astro';
import { loadWritingArea } from '../../../lib/content';
import { postCard, renderOg } from '../../../lib/og';
import type { Post } from '../../../lib/posts';

// A published post's link preview, beside its page: the post's title and its section. A draft has
// none, so nothing about it can be shared before it is published.
export const getStaticPaths = (async () => {
  const area = await loadWritingArea();
  return area.pages
    .filter((post) => !post.draft)
    .map((post) => ({ params: { section: post.section, slug: post.slug }, props: { post } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ post: Post }> = async ({ props }) => {
  const png = await renderOg(postCard(props.post));
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
