import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { commentWriterContract } from "../../shared/index.js";
import {
  commentWriterStatus,
  retryCommentWriter,
} from "../workflows/comment-writer.js";
import { requireOwner } from "./workflow-auth.js";

// The comment writer's status, and Retry, for Review's notice when it
// couldn't write some comments.
const api = new TsRestApi<SapportaEnv>();

api.register(
  "getCommentWriterStatus",
  commentWriterContract.getCommentWriterStatus,
  ({ c }) => {
    requireOwner(c);
    return { status: 200, body: commentWriterStatus(c.get("db")) };
  },
);

api.register(
  "retryCommentWriter",
  commentWriterContract.retryCommentWriter,
  ({ c }) => {
    requireOwner(c);
    return { status: 200, body: retryCommentWriter(c.get("db")) };
  },
);

export default api;
