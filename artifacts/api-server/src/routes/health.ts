import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

router.get("/healthz", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

export default router;
