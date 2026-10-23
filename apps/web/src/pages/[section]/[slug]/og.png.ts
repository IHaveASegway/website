import type { APIRoute, GetStaticPaths } from 'astro';
import { loadWritingArea } from '../../../lib/content';
import { postCard, renderOg } from '../../../lib/og';
import type { Post } from '../../../lib/posts';

// A listed post's link preview, beside its page: the post's title and its section. A draft or an
// unlisted post has none, so nothing about it can be shared before it is listed.
export const getStaticPaths = (async () => {
  const area = await loadWritingArea();
  return area.pages
    .filter((page) => page.exposure === 'listed')
    .map(({ post }) => ({ params: { section: post.section, slug: post.slug }, props: { post } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ post: Post }> = async ({ props }) => {
  const png = await renderOg(postCard(props.post));
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
