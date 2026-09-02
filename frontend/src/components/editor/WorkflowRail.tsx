"use client";

import { motion } from "motion/react";
import { WORKFLOW_STEPS, type WorkflowIndex } from "@/lib/studioAssets";
import { DUR, EASE } from "@/lib/motion";
import { useReducedMotionSafe } from "@/components/motion/useReducedMotionSafe";

type WorkflowRailProps = {
  current: WorkflowIndex;
};

export default function WorkflowRail({ current }: WorkflowRailProps) {
  const reduced = useReducedMotionSafe();
  const fill = current / (WORKFLOW_STEPS.length - 1);

  return (
    <aside className="flow-rail" aria-label="Workflow progress">
      <span className="flow-rail__label">Progress</span>
      <div className="flow-rail__track">
        <div className="flow-rail__line" aria-hidden="true">
          <motion.div
            className="flow-rail__fill"
            initial={false}
            animate={{ scaleY: fill }}
            transition={
              reduced ? { duration: 0 } : { duration: DUR.slow, ease: EASE }
            }
          />
        </div>
        {WORKFLOW_STEPS.map((step, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <div
              key={step.id}
              className={`flow-rail__step${done ? " is-done" : ""}${
                active ? " is-current" : ""
              }`}
              aria-current={active ? "step" : undefined}
              aria-label={`${step.label}. ${step.hint}${
                active ? " (current)" : done ? " (done)" : ""
              }`}
              title={`${step.label} — ${step.hint}`}
            >
              <span className="flow-rail__dot" aria-hidden="true">
                {active && !reduced ? (
                  <span className="flow-rail__pulse" />
                ) : null}
              </span>
              <span className="flow-rail__name">{step.label}</span>
            </div>
          );
        })}
      </div>
      <p className="flow-rail__now">
        {WORKFLOW_STEPS[current].label}
        <span>{WORKFLOW_STEPS[current].hint}</span>
      </p>
    </aside>
  );
}
