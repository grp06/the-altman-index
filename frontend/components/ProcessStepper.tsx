import type { Stage, StepStatus } from '../types';
import { PROCESS_STEPS, stageIndexMap } from '../lib/constants';
import styles from '../app/page.module.css';

type ProcessStepperProps = {
  stage: Stage;
};

export function ProcessStepper({ stage }: ProcessStepperProps) {
  const renderStepStatus = (stepStage: Stage): StepStatus => {
    const currentIndex = stageIndexMap[stage];
    const stepIndex = stageIndexMap[stepStage];
    if (stage === 'error' && currentIndex === stepIndex) {
      return 'error';
    }
    if (currentIndex > stepIndex) {
      return 'done';
    }
    if (currentIndex === stepIndex) {
      return 'active';
    }
    return 'pending';
  };

  return (
    <div className={styles.stepper}>
      {PROCESS_STEPS.map((step, index) => {
        const status = renderStepStatus(step.stage);
        return (
          <div
            key={step.stage}
            className={`${styles.step} ${status === 'done' ? styles.stepDone : ''} ${status === 'active' ? styles.stepActive : ''} ${
              status === 'error' ? styles.stepError : ''
            }`}
          >
            <div className={styles.stepIndicator}>
              <span>{index + 1}</span>
            </div>
            <div>
              <div className={styles.stepTitle}>{step.title}</div>
              <div className={styles.stepSubtitle}>{step.subtitle}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

