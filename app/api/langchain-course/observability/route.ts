import { CourseObservabilityRepository } from "../../../../lib/langchain/course-observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 返回最近 100 次汇总和最近 20 条运行，不包含问题正文和认证信息。 */
export async function GET() {
  const repository = new CourseObservabilityRepository();

  try {
    return Response.json(
      {
        summary: repository.summarizeRecentRuns(),
        recentRuns: repository.listRecentRuns(20),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    repository.close();
  }
}
