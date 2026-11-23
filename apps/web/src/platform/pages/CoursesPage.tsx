// Teachers and staff: Course Studio — courses OGC writes itself (a different person approves,
// published versions never change) and the course each class follows (the class teacher proposes,
// staff link with weekly prep hours that count in Workforce). Learners: My courses — the linked
// course, on the version they started. Owner 22/11 + 23/11, on the API. Synthetic courses.
import { CourseEditorView } from "../../features/studio/CourseEditorView";
import { StudioCoursesView } from "../../features/studio/StudioCoursesView";
import { ClassLessonView, MyClassCoursesView } from "../../features/learner/ClassCoursesView";
import { ALL_SKILLS, skillLabel } from "@ogc/contracts";
import { Card, EmptyState, PageHeader, ProgressBar } from "../../ui";
import { platformApi } from "../client";
import { useSignedIn } from "../App";
import { useQuery } from "@tanstack/react-query";
import { useClassCoursePlayerApi } from "../../features/learner/classCoursePlayerApi";
import {
  PlatformClassCoursePlayerApi,
  PlatformCourseStudioApi,
  PlatformStudioLinksApi,
} from "../courses";
import { PolicyBanner } from "../workforce";

export function PlatformCoursesPage() {
  return (
    <PlatformCourseStudioApi>
      <PlatformStudioLinksApi>
        <StudioCoursesView back={null} base="/courses" />
      </PlatformStudioLinksApi>
    </PlatformCourseStudioApi>
  );
}

export function PlatformCoursePage() {
  return (
    <PlatformCourseStudioApi>
      <PolicyBanner />
      <CourseEditorView base="/courses" />
    </PlatformCourseStudioApi>
  );
}

function MyCourses() {
  const api = useClassCoursePlayerApi();
  const q = useQuery({ queryKey: [...api.key, "mine"], queryFn: () => api.mine() });
  return (
    <section className="space-y-4">
      <PageHeader
        title="My courses"
        subtitle="Your skills and the course your class follows · staging"
      />
      {q.data === null ? <EmptyState title="Not available" hint="For learners." /> : null}
      {q.data && q.data.length === 0 ? (
        <EmptyState title="No class course yet" hint="Your class does not follow a course yet." />
      ) : null}
      <MySkills />
      <MyClassCoursesView />
    </section>
  );
}

/** The learner's skill profile: the placement seed moved by class-course quiz scores and, for
 *  Speaking, rehearsals the class teacher approved. */
function MySkills() {
  const s = useSignedIn();
  const q = useQuery({
    queryKey: ["my-skills", s.principalId],
    queryFn: () => platformApi.mySkills(s),
  });
  if (!q.data) return null;
  const p = q.data;
  return (
    <Card>
      <section aria-label="My skills" className="space-y-2">
        <h2 className="text-lg font-medium">
          My skills <span className="text-sm font-normal text-muted">· CEFR {p.cefrBand}</span>
        </h2>
        <ul className="space-y-2">
          {ALL_SKILLS.map((k) => {
            const m = p.skills[k];
            return (
              <li key={k} data-testid={`skill-${k}`}>
                <div className="flex justify-between text-sm">
                  <span>{skillLabel(k)}</span>
                  <span>
                    {m.level}{" "}
                    <span className="text-muted">
                      {m.evidenceCount
                        ? k === "speaking"
                          ? `· ${m.evidenceCount} approved rehearsal${m.evidenceCount === 1 ? "" : "s"}`
                          : `· ${m.evidenceCount} quiz${m.evidenceCount === 1 ? "" : "zes"}`
                        : "· placement test only"}
                    </span>
                  </span>
                </div>
                <ProgressBar pct={m.level} label={`${skillLabel(k)} level`} />
              </li>
            );
          })}
        </ul>
      </section>
    </Card>
  );
}

export function PlatformMyCoursesPage() {
  return (
    <PlatformClassCoursePlayerApi>
      <MyCourses />
    </PlatformClassCoursePlayerApi>
  );
}

export function PlatformClassLessonPage() {
  return (
    <PlatformClassCoursePlayerApi>
      <ClassLessonView />
    </PlatformClassCoursePlayerApi>
  );
}
