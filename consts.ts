import { resolve } from "bun";

export const LOCK_FILE = "lockfile.lock";
export const METADATA_DIR = "./metadata/";
export const TEMP_DIR = "./temp_media/";

const TRANSFER_TO_USER = "roberts";
const TRANSFER_TO_IP = "192.168.1.110";
export const TRANSFER_TO = `${TRANSFER_TO_USER}@${TRANSFER_TO_IP}`;
