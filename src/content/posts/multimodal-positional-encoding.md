---
notion_id: "3fdc82b072cb802699a8f7407649ef87"
title: "🕶️ 从位置编码到实际训练框架和模型架构中的多模态位置编码"
author: "Ruiyi Zhan"
pubDatetime: 2026-10-18T00:00:00.000Z
modDatetime: 2026-10-18T10:47:15.139Z
featured: false
draft: false
tags: ["位置编码","RoPE","多模态","Transformer"]
description: "从 Self-Attention 为什么缺位置信息讲起，逐步推到 Sinusoidal、RoPE、二维与三维 M-RoPE，以及 Qwen2-VL / Qwen3-VL 里的频率分配、Interleaving 和 YaRN。"
---

位置编码其实是一个讨论了很久的问题。我想先搞清楚：为什么 Attention 自己没法知道 token 排在第几个？然后再看 Sinusoidal 为什么要用三角函数，以及 RoPE 为什么最后会变成旋转。

从《Attention Is All You Need》开始，Transformer 就是用 Q、K、V 算 token 之间的关系。如果不加 Mask，也不加位置编码，Self-Attention 就是把所有 token 两两比一遍，但整个计算里根本没有“第几个 token”这个东西。

这里的“对称性”要说清楚一点。把输入的 token 顺序打乱，输出也会跟着以同样的方式被打乱。这叫**置换等变**（permutation equivariance），不是说输出完全不变：

$$
\operatorname{Attn}(PX)=P\operatorname{Attn}(X)
$$

这里 P 是置换矩阵。也就是说，模型能看到 token 的内容，但看不到它原来排在哪。要是后面再接一个对顺序不敏感的池化，最后的标量才会真的不变。当然这说的是没有位置编码、没有 Mask 的理想情况，Causal Mask 自己就会带进顺序信息。

所以我们得加位置编码，让同一个内容出现在不同位置时，参与的计算不一样。

原论文的 Sinusoidal 方案，是给不同的特征维度分不同的频率，每两个维度组成一对正弦和余弦：

$$
p_m^{(2i)}=\sin(m\theta_i),\qquad p_m^{(2i+1)}=\cos(m\theta_i),\qquad \theta_i=10000^{-2i/d}
$$

其中 m 是 token 的位置。也就是说，每个二维小空间都按自己的频率去记位置。

我之前一直疑惑：为什么非得用三角函数？一个很直接的理由是，三角函数有和差角公式：

$$
\cos((m-n)\theta)=\cos(m\theta)\cos(n\theta)+\sin(m\theta)\sin(n\theta)
$$

所以同一个频率下，两个位置向量一做内积，m−n 就自己冒出来了：

$$
(\cos(m\theta),\sin(m\theta))^\top(\cos(n\theta),\sin(n\theta))=\cos((m-n)\theta)
$$

这说明 Sinusoidal **天然带着表示相对位移的结构**。不过位置编码是加在 embedding 上的，后面还要过 Q、K 投影和好几层，所以没法直接说实际的 Attention Score 就只看 m−n。

可以把位置编码当成给输入加了一点扰动。假设模型最后输出一个标量 f，我们先只看两个 token，它们的 embedding 是 x_m、x_n，各自加上位置向量 p_m、p_n。

想知道的是：

$$
\tilde f=f(\ldots,x_m+p_m,\ldots,x_n+p_n,\ldots)
$$

和原来的 f 差在哪。

为什么能做二元泰勒展开？可以用同一个参数 t 把两个扰动串起来：

$$
h(t)=f(\ldots,x_m+tp_m,\ldots,x_n+tp_n,\ldots)
$$

这样 h(0)=f，h(1)=tilde f。h 现在是一元函数，直接做一元泰勒展开，再用链式法则，就能得到多元的版本。只要 f 在附近够光滑、扰动够小，展开到二阶就是：

$$
\begin{aligned}
\tilde f\approx {}&f+p_m^\top\nabla_{x_m}f+p_n^\top\nabla_{x_n}f\\
&+\frac12p_m^\top H_{mm}p_m+\frac12p_n^\top H_{nn}p_n\\
&+\underbrace{p_m^\top H_{mn}p_n}_{\text{两个位置的混合二阶交互}}
\end{aligned}
$$

这里 H_mn 是 d×d 的混合 Hessian 块。它第 (i,j) 项的意思是：x_n 的第 j 个特征变一下，f 对 x_m 第 i 个特征的敏感程度会跟着怎么变。

我原来以为“对角元会比较大”，这里要改一下。**一般的 Hessian 并不会天然接近对角阵。** 对最简单的点积 f(q,k)=qᵀk，对 q、k 的混合 Hessian 确实是单位阵；但 q=W_Q x_m、k=W_K x_n 的话，对输入 embedding 来说就成了 W_QᵀW_K，通常是个稠密矩阵。

所以泰勒展开只能告诉我们：两个位置编码可能通过混合项互相影响。至于 Hessian 是不是对角、交互项是不是只看位置差，它都保证不了。而且这终究只是局部近似。

问题到这就具体了：与其指望位置编码过完投影之后刚好还留着相对位置，为什么不直接在 Q、K 的交互里把这个性质做进去？

RoPE 就是这么做的：每两个特征维度当成一个二维平面，位置 m 就对应转一个角度。二维向量可以写成复数：

$$
q=q_1+iq_2,\qquad k=k_1+ik_2
$$

二维点积恰好等于复数乘积的实部：

$$
\langle q,k\rangle=\operatorname{Re}(q\bar{k})
$$

我们希望编码之后，点积里位置只通过 m−n 出现：

$$
\operatorname{Re}[f(q,m)\overline{f(k,n)}]=g_{\mathbb R}(q,k,m-n)
$$

原推导为了好解，其实**偷偷加强了一步条件**：不只要实部，整个复数乘积（实部加虚部）都只依赖 m−n：

$$
f(q,m)\overline{f(k,n)}=G(q,k,m-n)
$$

这个条件够用，但不是必须的，满足原始目标的编码不一定都得满足它。

接下来把复数写成极坐标：

$$
f(q,m)=R_f(q,m)e^{i\Theta_f(q,m)}
$$

复数相乘，模长相乘、角度相减（角度按模 2π 算）。

先让两个位置相同，m=n，再加上初始条件 f(q,0)=q，就能得到模长不会随位置变：

$$
R_f(q,m)=\|q\|
$$

再看角度。位置相同的时候，两个编码后的角度差不能跟位置有关。所以每个输入多出来的那部分角度，只能是一个跟内容 q 无关的函数 φ(m)：

$$
\Theta_f(q,m)=\Theta(q)+\varphi(m)
$$

两个位置之间转多少只看位置差，那相邻两个位置之间转的角度就必须每次都一样：

$$
\varphi(m)-\varphi(m-1)=\theta
$$

这就是个等差数列。取 φ(0)=0，整数位置上就有：

$$
\varphi(m)=m\theta
$$

于是：

$$
\boxed{f(q,m)=qe^{im\theta}}
$$

代回点积：

$$
\langle f(q,m),f(k,n)\rangle=\operatorname{Re}[q\bar{k}e^{i(m-n)\theta}]
$$

这样，**位置就只会以 m−n 的形式进到 Attention Score 里**。分数当然还是要看 q、k 的内容，不是说距离一样分数就一样。

实际的 Q、K 是 d 维的。RoPE 把维度两两分组，得到 d/2 个二维小空间，每组有自己的频率 θ_i：

$$
R(m\theta_i)=\begin{bmatrix}\cos(m\theta_i)&-\sin(m\theta_i)\\\sin(m\theta_i)&\cos(m\theta_i)\end{bmatrix}
$$

给 Q、K 按各自的位置转一下，再求点积。因为：

$$
R(m\theta_i)^\top R(n\theta_i)=R((n-m)\theta_i)
$$

所以相对位置这个性质在每个二维小空间里都保留着，把多个小空间加起来也一样。

我现在的理解是：Sinusoidal 靠三角函数本身带了一点相对位置的结构；RoPE 更进一步，直接把旋转作用在 Q、K 上，点积出来就明明白白是相对位移的形式。后面看 MRoPE 就可以接着问：位置不再是一个整数 m，而是时间、高度、宽度这几个坐标，那频率和坐标要怎么分？

> 这里只讨论理想化的二维 RoPE 和整数位置。推导只是给出了一种满足条件的做法，没有证明它唯一，也没法直接说明长序列外推效果好不好。

其实到这里结论很简单：**把多个一维 RoPE 拼成 block-diagonal 矩阵，就能扩展到二维位置。** 每个 2×2 的旋转块只管两个特征；一部分特征组给行坐标 x，另一部分给列坐标 y。两个坐标各转各的，互不影响。

拿 **head dimension = 8** 的 Q 举个例子。假设这个 token 在图像上的位置是 (x,y)=(2,3)，取：

$$
q=[1,0,\;0,1,\;1,0,\;0,1]^\top
$$

8 个特征正好分成四组，每组两个维度。前两组看 x=2，后两组看 y=3，每组的频率分别是 θ₀、θ₁、θ₂、θ₃：

$$
\mathcal R_{2,3}=\operatorname{diag}\big(R(2\theta_0),R(2\theta_1),R(3\theta_2),R(3\theta_3)\big)
$$

每个块就是一个普通的二维旋转：

$$
R(\alpha)=\begin{bmatrix}\cos\alpha&-\sin\alpha\\\sin\alpha&\cos\alpha\end{bmatrix}
$$

真算起来就是四个互不相干的小计算：

$$
\begin{aligned}
(q_0,q_1)=(1,0)&\longrightarrow(\cos2\theta_0,\;\sin2\theta_0)\\
(q_2,q_3)=(0,1)&\longrightarrow(-\sin2\theta_1,\;\cos2\theta_1)\\
(q_4,q_5)=(1,0)&\longrightarrow(\cos3\theta_2,\;\sin3\theta_2)\\
(q_6,q_7)=(0,1)&\longrightarrow(-\sin3\theta_3,\;\cos3\theta_3)
\end{aligned}
$$

最后把四组结果拼回去，就是转完之后的 8 维 Q。实际上不用真去建一个 8×8 矩阵，Kernel 直接按组做 sin/cos 的乘加就行，计算量跟 head dimension 成线性关系。

**为什么还能表示相对位置？** 因为每一组都满足：位置 b 的旋转乘上位置 a 的逆旋转，就等于转位置差 b−a。所以整体也一样：

$$
\mathcal R_{x_1,y_1}^\top\mathcal R_{x_2,y_2}
=\mathcal R_{x_2-x_1,\;y_2-y_1}
$$

这就是二维 RoPE 的核心。扩展到三维 (t,h,w) 也一样，多分几组二维特征给不同的坐标轴就行。至于每个轴分多少组、每组用什么频率，那是另外的设计选择。

前面二维 RoPE 已经明白了：把 Q、K 的二维特征组分给不同的坐标轴，每组还是普通的旋转。三维 M-RoPE 并没有多出什么新的旋转运算，只是位置从 (x,y) 变成了 (t,h,w)，分别是时间、高度、宽度。这里的“三维”是说位置有三个分量，不是在三维特征空间里做 3×3 旋转。

Qwen2-VL 里，每个 token 的三个位置 ID 按模态来赋值：

- 文本： (m,m,m)，三个轴用同一个位置，所以就退化成 1D RoPE。
- 图片： (t₀,h,w)，同一张图的时间坐标不变，行列坐标随 Patch 变。
- 视频： (t,h,w)，不同帧时间坐标不同，帧内用行列坐标。

注意这不是把频率表复制三份。拿 Qwen2-VL-7B 来说，head_dim = 128，一共 64 组二维旋转，配置里把它们分给 T/H/W，分别是 16/24/24 组。每组还是用自己的 RoPE 频率，只是旋转角里乘的那个位置，是从 t、h、w 里挑一个。三个轴也不用严格三等分。

读[《Transformer升级之路：17、多模态位置编码的简单思考》](https://spaces.ac.cn/archives/10040)的时候，我一开始没搞懂 Scale 是在解决什么。关键是：**它不是二维 RoPE 数学上必须有的东西，只是图文混排时，为了把坐标接上的一个约定。**

为了让纯文本还是 1D RoPE，文章要求文本的位置落在对角线 (n,n) 上。假设图片前最后一个文本位置是 (L,L)，图片有 h 行、w 列。如果图片位置直接编成 (L+i,L+j)，进图片的增量是 (1,1)，而最后一个 Patch 在 (L+h,L+w)，出来再加 (1,1) 就到了 (L+h+1,L+w+1)。h≠w 的时候，这就不在对角线 x=y 上了，下一段文本就没法同时满足“文本两个轴相等”和“进出图片的增量对称”。

苏剑林的办法是让图片的行、列各用一个步长 s、u（第二个我写成 u，免得跟时间轴 t 混了）：

$$
(x,y)=(L+is,\;L+ju),\qquad i=1,\ldots,h,\quad j=1,\ldots,w
$$

从前面的文本进图片，坐标增量是 (s,u)。我们希望从图片最后一个 Patch 出来时增量也是 (s,u)，而且正好回到文本的 (K,K)，那就必须有：

$$
K=L+(h+1)s=L+(w+1)u
$$

即：

$$
\boxed{(h+1)s=(w+1)u}
$$

最简单的正整数取法是 s=w+1、u=h+1。两个轴每步走的距离不一样，但走完之后刚好落在同一个数上。

下面的例子统一假设图片前面有两个文本 token，位置是 0 和 1，所以最后一个文本在 (1,1)，换成 Qwen2-VL 的三轴写法就是 (1,1,1)。

**苏剑林的二维 Scale 方案：** h=2、w=3，所以 s=4、u=3。图片六个 Patch 的位置是：

$$
\begin{matrix}
(5,4)&(5,7)&(5,10)\\
(9,4)&(9,7)&(9,10)
\end{matrix}
$$

进图片： (1,1) → (5,4)，增量 (4,3)；出图片： (9,10) → (13,13)，增量还是 (4,3)。所以图片后面第一个文本的位置是 **(13,13)**。

**Qwen2-VL 的方案：** 不要求进出两边的增量一样。图片的 T 轴固定为 2，H/W 就按网格往上数：

$$
\begin{matrix}
(2,2,2)&(2,2,3)&(2,2,4)\\
(2,3,2)&(2,3,3)&(2,3,4)
\end{matrix}
$$

图片的位置 ID 在三个轴上最大是 4；Qwen2-VL 规定下一段从上一段的最大位置 ID 加 1 开始，所以后面第一个文本就是 **(5,5,5)**，再往后是 (6,6,6)。

最后别把两种“位置”搞混：图像 token 喂给 Attention 的时候，还是排成一维序列的，Causal Mask 和 KV Cache 要用的是这个顺序；M-RoPE 是另外给每个 token 一组三轴坐标，只用来旋转 Q/K。Scale 不 Scale，改的是后者，不影响 token 能看到谁。

接着 Qwen2-VL 的 (t,h,w) 三轴位置往下说。我最开始的问题是：频率表明明可以直接改，为什么 Qwen3-VL 还要换成交错分组？后来才发现，**频率的数值，和这个频率分给哪个轴，是两件独立的事**。

对第 i 个二维旋转组，角度可以统一写成：

$$
\alpha_i=p_{a(i)}\theta_i,\qquad a(i)\in\{T,H,W\}
$$

θ_i 是旋转频率，a(i) 决定这一组用时间 T、高度 H、宽度 W 里哪个轴的位置。

还是以 head_dim=128 为例：128 个特征组成 64 个二维旋转组。Qwen2-VL 用 `mrope_section=[16,24,24]`，按频率索引一刀切下去：前 16 组给 T，中间 24 组给 H，最后 24 组给 W。RoPE 的频率是随索引递减的，所以 T 全在高频，H 在中频，W 在低频，三个轴拿到的频率范围很不均匀。

Qwen3-VL-8B 的**默认**配置是：

```json
{
  "rope_scaling": {
    "rope_type": "default",
    "mrope_section": [24, 20, 20],
    "mrope_interleaved": true
  }
}
```

`mrope_section` 是分给 T、H、W 的旋转组数量：24+20+20=64 组，对应 128 维。它既不是频率数值，也不是位置 ID。

`mrope_interleaved=true` 的意思是轴交错着取。**不均分也能交错**：前 60 个频率槽位按 T、H、W 依次轮流，重复 20 次；最后 4 个最低频的槽位都给 T，就凑成了 24/20/20。用 Python 示意一下这个分配规则（不是模型源码）：

```python
axes = ["T", "H", "W"] * 20 + ["T"] * 4
assert [axes.count(a) for a in ("T", "H", "W")] == [24, 20, 20]
print(axes[:9])  # ["T", "H", "W", "T", "H", "W", "T", "H", "W"]
```

这样三个轴都能分到高、中、低频的旋转组，时间轴还多拿了最后四组低频。

当然也可以重新设计频率，但 Qwen3-VL 没这么做，它保留原来 1D RoPE 的那串频率，只改了频率和轴之间的对应关系。以 Qwen3-VL-8B 的 `head_dim=128`、`rope_theta=5000000` 为例：

$$
\theta_i=(5000000)^{-i/64},\qquad i=0,\ldots,63
$$

假如一个视觉 token 的位置是 (t,h,w)=(2,3,4)，交错之后前六个旋转角是：

$$
2\theta_0,\;3\theta_1,\;4\theta_2,\;2\theta_3,\;3\theta_4,\;4\theta_5
$$

而纯文本是 (t,h,w)=(m,m,m)，不管频率组怎么分给 T/H/W，结果都会变回普通的 1D RoPE：

$$
m\theta_0,\;m\theta_1,\;\ldots,\;m\theta_{63}
$$

所以 Interleaving 一方面让三个轴的频率分布更均匀，另一方面纯文本的位置编码还是原来的样子。当然它不是数学上唯一的解。

Interleaving 改的是轴的映射 a(i)；YaRN 改的主要是频率 θ_i 的数值，目的是上下文长度外推。原始 RoPE 在远超训练长度的位置上也能算，但模型可能压根没见过那么远距离的相位组合。

最粗暴的办法是把所有频率都除以扩展倍率 s，也就是统一做位置插值：

$$
\theta_i'=\frac{\theta_i}{s}
$$

问题是，近距离的旋转关系也被一起改掉了。YaRN 的 NTK-by-parts 思路是：高频尽量保留，中频平滑过渡，低频多做插值。大致可以写成：

$$
\theta_i'=\gamma_i\theta_i+(1-\gamma_i)\frac{\theta_i}{s}
$$

其中 γ_i 是随频率索引变化的权重。边界具体在哪，要看原始上下文长度、RoPE base、`beta_fast`、`beta_slow` 这些参数；另外 YaRN 还有一个 Attention 缩放的修正，所以不能简单当成“所有频率都除以 s”。

以 Qwen3-VL-8B、`factor=3` 为例：`head_dim=128`、`rope_theta=5000000`、原始长度 262144，用 Transformers 默认的 `beta_fast=32`、`beta_slow=1`：

```python
import math
d, base, L0, factor = 128, 5_000_000, 262_144, 3.0

def boundary(beta):
    return d * math.log(L0 / (2 * math.pi * beta)) / (2 * math.log(base))

low, high = math.floor(boundary(32)), math.ceil(boundary(1))  # 29, 45
theta = [base ** (-2 * i / d) for i in range(d // 2)]
ramp = [max(0, min(1, (i - low) / (high - low))) for i in range(d // 2)]
theta_new = [(1 - r) * t + r * t / factor for r, t in zip(ramp, theta)]
print(theta_new[37] / theta[37])  # 0.6667：第 37 组频率变为原来的 2/3
```

这段代码只演示了 YaRN 的**逐频率插值**，没包含那个 Attention 缩放。`beta_fast` / `beta_slow` 是按原始上下文长度里转了多少圈来定边界的，不是直接填频率索引。

目标长度可以直接理解成原始长度乘倍率：

$$
L_{\mathrm{target}}=L_{\mathrm{original}}\times s
$$

原始长度是 16,384（16 Ki tokens）的话，`factor=3` 就是 49,152（48 Ki tokens）。Qwen3-VL-8B 原生长度是 262,144，三倍就是 786,432 token。不过这只是缩放后的名义长度，**不代表效果不掉，也不代表推理服务真能跑到这么长**。

Qwen3-VL 默认没开 YaRN。需要超长上下文的话，官方给了下面这个和 Interleaving 一起用的示例配置：

```json
{
  "rope_scaling": {
    "rope_type": "yarn",
    "mrope_section": [24, 20, 20],
    "mrope_interleaved": true,
    "factor": 3.0,
    "original_max_position_embeddings": 262144
  }
}
```

三者最后统一成：

$$
\boxed{\alpha_i=p_{a(i)}\,\theta_i^{\mathrm{YaRN}}}
$$

**位置 ID 给出 T/H/W 的坐标；Interleaving 决定每一组去读哪个轴；YaRN 决定这一组转得多快。** 三个可以一起用，但各管各的事。
