// Google Analytics tracking utilities

declare global {
  interface Window {
    gtag: (...args: any[]) => void;
  }
}

export const trackEvent = (eventName: string, parameters: Record<string, any> = {}) => {
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('event', eventName, parameters);
  }
};

export const trackQuestionSubmitted = (question: string, questionType?: string) => {
  trackEvent('question_submitted', {
    question_length: question.length,
    question_type: questionType || 'auto',
    question_preview: question.substring(0, 100), // First 100 chars for analytics
  });
};
