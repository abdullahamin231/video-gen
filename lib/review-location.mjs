// T3 owns production and feedback; the person reviews in their own browser on the tailnet.
export const REVIEW_URL = 'https://ip-208-84-101-178.tailc5adba.ts.net:8443/';

export function reviewLocationStep(slug) {
  return `run \`npm run video -- watch --project ${slug}\`, follow its Tailscale serving instructions, and verify the target port with \`tailscale serve status\`. Give the user ${REVIEW_URL} to review in their own browser; do not open T3's preview panel.`;
}

export function watchInstructions(url, slug, reused) {
  return [`Local overview: ${url}`, `Local player:   ${url}player/`,
    reused ? 'Already running.' : 'Started in the background.',
    `Serve this project for review: tailscale serve --bg --https=8443 ${url}`,
    'If 8443 points to another project, first run: tailscale serve --https=8443 off',
    'Verify the target port: tailscale serve status',
    `Review: ${REVIEW_URL}`,
    'The user reviews in their own browser and replies in T3 chat. Do not open the T3 preview panel.',
    'Keep the existing video UI and its Tailscale route running; only change the review route on 8443.',
    `Read-only: nothing is rendered or changed. Stop when the user is done: npm run video -- watch --project ${slug} --stop true`].join('\n');
}
