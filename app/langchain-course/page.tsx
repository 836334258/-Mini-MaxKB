import { readCourseModelConfig } from "../../lib/langchain/model-config";
import CourseChat from "./course-chat";

/** 由服务端读取默认模型，只把非敏感配置传给浏览器组件。 */
export default function LangChainCoursePage() {
  const modelConfig = readCourseModelConfig();

  return (
    <CourseChat
      defaultModel={modelConfig.model}
      defaultProvider={modelConfig.modelProvider}
    />
  );
}
