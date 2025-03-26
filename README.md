# transcoder-win
This project transcodes any media in a directory and sends the output to a server via scp.

This project is meant to run in Windows via WSL and interact with the Windows version of HandBrakeCLI.

## How i have it set up:
* A frontend, which:
  * Takes in a .torrent file or magnet link (which is converted to a .torrent file)
  * Is able to select what kind of media is being uploaded (Anime, Movies, TV Shows)
  * Wakes Windows PC via Wake on LAN
  * Sends .torrent file and upload/processing info .json via SCP to Windows
* Qbittorrent:
  * Watches directory for .torrent files and automatically starts torrenting
  * Upon torrent finish, calls this project's index.ts
  * Keeps torrenting untill specific requirements are met.
* This project:
  * Exports specific language subtitles from .mkv files
  * Uses a binary search type to generate a clip of the media and estimate it's full size and bitrate, adjusts quality setting to have the best quality for the source and type of content
  * Transcodes all media with the best quality, with a custom handbrake preset as a base. Uses AMD hardware encoding
  * Removes all unneeded files and source files from temp folder, keeping only the transcoded media and the extracted subtitles
  * Via SCP sends the media to an Ubuntu server, in which i host Jellyfin
  * Removes Transcoded files from Windows PC.
 
### What would i like to do in the future:
* Have an automatic file renamer and sorter, in which i wouldnt have to manually check if jellyfin recognizes the media and if the media is in a specific folder structure
* Have the Windows PC also go to sleep after all torrents have finished transcoding

### To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts {torrent_name / JSON basename} {windows/path/to/source}
```

This project was created using `bun init` in bun v1.2.5. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
