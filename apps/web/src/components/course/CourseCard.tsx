import type { CatalogItem } from "@codeapt/shared";
import { BookOpen, CheckCircle2, FileText, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

import { HoverLift } from "../motion/index.js";
import { Badge } from "../ui/badge.js";
import { Card } from "../ui/card.js";
import { CourseThumb } from "./CourseThumb.js";
import { PriceTag } from "./PriceTag.js";

export function CourseCard({ item }: { item: CatalogItem }) {
  return (
    <Link
      to={`/courses/${item.slug}`}
      className="group block h-full rounded-2xl focus-visible:outline-none focus-visible:shadow-focus"
    >
      <HoverLift className="h-full">
        <Card className="flex h-full flex-col overflow-hidden">
        <div className="relative">
          <CourseThumb name={item.name} image={item.image} className="h-32 w-full" />
          <div className="absolute right-3 top-3 flex gap-2">
            {item.isPopular ? (
              <Badge variant="primary" className="backdrop-blur">
                <Sparkles className="h-3 w-3" /> Popular
              </Badge>
            ) : null}
            {item.isEnrolled ? (
              <Badge variant="success" className="backdrop-blur">
                <CheckCircle2 className="h-3 w-3" /> Enrolled
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-3 p-5">
          {item.program ? (
            <span className="text-xs font-medium uppercase tracking-wide text-primary">
              {item.program.name}
            </span>
          ) : null}
          <h3 className="text-base font-semibold leading-snug text-ink">
            {item.name}
          </h3>
          <p className="line-clamp-2 flex-1 text-sm text-ink-muted">
            {item.description}
          </p>

          <div className="flex items-center gap-4 text-xs text-ink-muted">
            <span className="inline-flex items-center gap-1">
              <BookOpen className="h-3.5 w-3.5" /> {item.moduleCount} modules
            </span>
            <span className="inline-flex items-center gap-1">
              <FileText className="h-3.5 w-3.5" /> {item.topicCount} topics
            </span>
          </div>

          <div className="mt-1 flex items-center justify-between border-t border-subtle pt-3">
            <PriceTag
              price={item.price}
              discountPrice={item.discountPrice}
              effectivePrice={item.effectivePrice}
              isFree={item.isFree}
            />
            <span className="text-sm font-medium text-primary group-hover:underline">
              {item.isEnrolled ? "Continue" : "View"} →
            </span>
          </div>
        </div>
        </Card>
      </HoverLift>
    </Link>
  );
}
