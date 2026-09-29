import { Router } from "express";
import { HttpError } from "../http/errors.ts";
import { UpstreamError } from "../services/upstream.ts";
import { normalizeArtccId, type VnasService } from "../services/vnas.ts";

export function vnasRouter(vnas: VnasService): Router {
  const router = Router();

  router.get("/artccs/:id", async (req, res) => {
    const id = normalizeArtccId(req.params.id);
    if (!id) throw new HttpError(400, "ARTCC id must look like ZME or KZME");
    let doc;
    try {
      doc = await vnas.artcc(id);
    } catch (e) {
      if (e instanceof UpstreamError && e.status === 404)
        throw new HttpError(404, `no ARTCC ${id}`);
      if (e instanceof UpstreamError) throw new HttpError(502, "vNAS unavailable");
      throw e;
    }
    res.set({
      "Cache-Control": "public, max-age=300",
      "X-Cache-Fetched-At": new Date(doc.fetchedAt).toISOString(),
      ...(doc.stale ? { Warning: '110 - "stale"' } : {}),
    });
    res.json(doc.value);
  });

  return router;
}
