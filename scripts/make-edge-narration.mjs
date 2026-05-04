import { mkdir, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'

const outputDir = 'C:/Users/cyh/Downloads/腾讯十万/koc-engine-vercel/submission'
const textPath = `${outputDir}/KOC-Engine_完整算法版路演稿.txt`
const audioPath = `${outputDir}/KOC-Engine_完整算法版旁白.mp3`

const narration = [
  '各位评委好，我展示的是 KOC-Engine，一个面向 PCG 内容供给侧的多模态逆向解析引擎。',
  '它的核心目标，是把爆款内容里看起来很玄的网感，拆成可解释、可复用、可验证的增长结构。',
  '当前版本已经实现一条可运行的可解释算法管线：链接校验、页面元信息抓取、平台识别、关键词和语义特征提取、五维雷达评分、六十秒留存曲线生成，以及逐句脚本 Diff 重构。',
  '现在我输入一条腾讯视频内容链接。点击启动后，系统会按五个阶段运行。第一步识别平台和 URL 结构，第二步抽取 OpenGraph 标题、描述和封面等元信息，第三步计算 Hook、证据、情绪和 CTA 特征，第四步生成留存曲线，第五步输出可执行的脚本改写。',
  '这里需要强调，模型并不是唯一核心。基础分数和曲线来自规则化特征工程：例如前 3 秒留存由 Hook 词、标题压缩度和平台先验共同决定；证据强度由实拍、对比、数据、反馈等词命中，以及页面元信息置信度共同决定；转化收口则看链接、领取、库存、评论等行动词。',
  '结果区里可以看到，系统给出了算法来源、置信度和证据等级。下面四张卡不是简单结论，而是把分数背后的证据写出来：开场抓取效率、内容证据强度、情绪波峰分布和转化收口效率，都能追溯到特征命中和曲线节点。',
  '雷达图展示的是内容指纹。视觉张力、BGM 契合、前 3 秒留存、情绪波动和 Hook 密度五个维度，会随着不同链接和元信息实时变化。留存曲线则预测零到六十秒的观看完成率，并标出 Hook 介入、证据补强和 CTA 收口的位置。',
  '最后看脚本 Diff。左侧是原句，中间是问题标签，右侧是高转化改写句，最右侧解释为什么这么改。它不是单纯生成一段文案，而是把创作者常见的低效表达，转换成平台可以复用的 SOP。',
  '从商业角度，KOC-Engine 解决的是内容供给效率问题。它可以降低中腰部 KOC 的试错成本，让运营团队更快判断一条内容为什么有效，以及该如何迁移到视频号、QQ 空间和腾讯内容生态的其他场景。',
  '后续接入真实业务数据后，这套可解释特征工程还可以继续进入 A/B Test，把 Hook 前置、证据强度和 CTA 清晰度，与次日留存、转化率和 LTV 除以 CAC 的变化关联起来。谢谢各位评委。',
].join('\n\n')

await mkdir(outputDir, { recursive: true })
await writeFile(textPath, narration, 'utf8')

const args = [
  '-m',
  'edge_tts',
  '--voice',
  'zh-CN-XiaoxiaoNeural',
  '--rate',
  '+6%',
  '--text',
  narration,
  '--write-media',
  audioPath,
]

const child = spawn('python', args, { stdio: 'inherit' })
const exitCode = await new Promise((resolve) => child.on('close', resolve))
if (exitCode !== 0) {
  throw new Error(`edge-tts failed with exit code ${exitCode}`)
}

console.log(audioPath)
