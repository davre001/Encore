import type { Decision } from "../types";

const API = "/api";

export async function uploadVideo(_file: File): Promise<void> {}

export async function listMessages(_videoId: string): Promise<void> {}

export async function sendMessage(_videoId: string, _text: string): Promise<void> {}

export async function listMoments(_videoId: string): Promise<void> {}

export async function decideMoment(_momentId: string, _decision: Decision): Promise<void> {}

export async function listClips(_videoId: string): Promise<void> {}

export async function postClip(_clipId: string): Promise<void> {}

export async function checkPost(_postId: string): Promise<void> {}
