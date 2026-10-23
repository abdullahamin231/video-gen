# YouTube uploads

The uploader uses the YouTube Data API v3 and the narrowly scoped OAuth permission
`https://www.googleapis.com/auth/youtube.upload`. It uploads the video and metadata as a resumable transfer.

## One-time authorization

1. In Google Cloud, enable YouTube Data API v3, configure the OAuth audience and add the Google account that owns the
   channel as a test user.
2. Create a Desktop app OAuth client and save its downloaded JSON as
   `.cache/video-gen/youtube-oauth/credentials.json`.
3. Run `npm run video -- youtube-auth` and open the URL printed by the command. Sign in with the account that owns
   the channel and approve video upload access. The local callback stores the refresh token at
   `.cache/video-gen/youtube-oauth/token.json` with owner-only permissions.

If the repo runs on a server and sign-in happens on a laptop, keep `youtube-auth` running on the server. Read the
callback port printed by the command, then from the laptop open a private SSH tunnel over Tailscale:

```sh
ssh -N -L <port>:127.0.0.1:<port> <server-user>@<server-tailnet-ip>
```

Open the printed Google URL on the laptop while the tunnel is running. Once Google reports authorization complete,
press Ctrl+C in the laptop terminal to close the tunnel. The callback listener closes after authorization; no public
port or Tailscale Serve route is needed.

Both files are under `.cache/`, which is ignored by Git. Never commit them or share their contents. The uploader
refreshes short-lived access tokens automatically. Google expires authorizations for External apps in Testing after
seven days, so the user must authorize again after that period.

## Upload a video

```sh
npm run video -- youtube-upload --file jobs/<slug>/renders/video.mp4 --title "Video title" \
  --description "Video description" --privacy unlisted --tag "AI" --tag "technology"
```

`--file` and `--title` are required. `--description` and repeatable `--tag` are optional. Privacy defaults to
`unlisted`; choose `private` or `public` explicitly if wanted. Completed videos are uploaded as unlisted by default.
Category defaults to `28` (Science & Technology) and can be changed with `--category <id>`.

The video orchestrators run this command after the video is delivered and its thumbnail is chosen, using the video's
approved title and `--privacy unlisted`. The YouTube link is included with the delivered MP4 and thumbnail.

An upload requires the authorized channel account to remain valid and YouTube API access to be enabled in the same
Google Cloud project as the OAuth client.
