import { $ } from "bun";
import { TRANSFER_DIR, TRANSFER_TO } from "./consts";
import { log, type JSONMetadata } from "./utils";

export const transferFiles = async (
  absoluteDestinationDir: string,
  jsonData: JSONMetadata,
) => {
  if (jsonData.torrent_type === "new") {
    await $`scp -r "${absoluteDestinationDir}" ${TRANSFER_TO}:"${TRANSFER_DIR}"`;
  } else {
    await $`scp -r "${absoluteDestinationDir}"/* ${TRANSFER_TO}:"${TRANSFER_DIR}"`;
  }
  log(`Transfer to ${TRANSFER_TO}:${TRANSFER_DIR} complete!`);
};
