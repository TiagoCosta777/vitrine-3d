# Vitrine 3D — processamento de imagens e visualização de produtos para pequenos varejistas

> Roteiro de fala atualizado: [ROTEIRO_APRESENTACAO_VITRINE_3D.md](ROTEIRO_APRESENTACAO_VITRINE_3D.md). A nova versão prioriza os problemas da empresa e suas soluções, com tecnologias e lógica concentradas no slide 9. O conteúdo abaixo permanece como referência de apoio.

Base de apresentação acadêmica, organizada a partir das orientações de `ProjetoFinal0610-01.pptx` (slides 2 a 9). O cenário empresarial abaixo é uma proposta fictícia; deve ser validado pelo grupo. O sistema existente permanece inalterado.

**Disciplina confirmada: Computação Gráfica.** O foco técnico da apresentação será o percurso das imagens capturadas até a representação geométrica e a renderização interativa. A ementa detalhada ainda precisa ser conferida.

## 1. Empresa e público-alvo

- **Empresa do cenário:** Mercado Boa Vizinhança, pequeno varejista fictício de bairro.
- **Segmento:** comércio varejista de produtos de uso cotidiano.
- **Perfil proposto:** comércio de bairro com equipe pequena, que prepara suas próprias imagens de produtos.
- **Usuários do sistema:** proprietário e funcionários responsáveis pelo cadastro e pela apresentação visual dos produtos.
- **Solução desenvolvida:** Vitrine 3D, nome do sistema de captura e digitalização, também utilizado na interface.

O varejista é a empresa estudada; Vitrine 3D é o sistema que o apoia. Essa distinção permite relacionar o problema da empresa às funcionalidades demonstradas.

## 2. Missão, visão e valores propostos para o varejista

**Missão:** oferecer produtos do dia a dia à comunidade, com atendimento próximo e informações claras para os clientes.

**Visão:** ser reconhecido no bairro pela confiança, organização e facilidade para conhecer os produtos disponíveis.

**Valores:** transparência nas informações, proximidade com o cliente, organização, acessibilidade e responsabilidade.

## 3. Problema escolhido

No cenário proposto, o varejista precisa preparar imagens para divulgar seus produtos, mas o trabalho é feito de maneira manual. Fotos com enquadramentos e fundos diferentes dificultam a apresentação consistente dos itens. Arquivos dispersos também tornam a localização e a reutilização das imagens mais trabalhosas.

O problema do projeto é **como apoiar a produção e a organização de um acervo visual de produtos usando o celular**.

O proprietário e os funcionários que preparam esse material são os principais envolvidos. Antes da apresentação, o grupo deve sustentar o diagnóstico com um exemplo demonstrável ou um relato autorizado. Se não houver pesquisa com uma empresa real, apresentar o caso explicitamente como fictício.

## 4. Objetivo e solução desenvolvida

**Objetivo geral:** aplicar processamento de imagens, modelagem geométrica e renderização 3D para apoiar pequenos varejistas na digitalização e apresentação visual de seus produtos.

Texto sugerido para explicar a solução:

> O Vitrine 3D é um projeto de Computação Gráfica aplicado à apresentação de produtos de pequenos varejistas. A partir de seis fotos capturadas pelo celular, o sistema separa o objeto do fundo, utiliza seus contornos para estimar uma malha e projeta as imagens sobre essa superfície. O usuário pode explorar a visualização 3D aproximada por diferentes ângulos, aproximar a câmera, ajustar o formato e aplicar um plano de clipping.

Funcionalidades já disponíveis:

- Captura guiada de frente, direita, verso, esquerda, topo e base.
- Captura automática com espera de estabilização, botão de captura manual e alternativa com a câmera de fotos do celular.
- Remoção do fundo no servidor, com preservação das imagens originais.
- Nome opcional, armazenamento das capturas e reabertura pela biblioteca.
- Volume 3D aproximado pelos contornos das imagens, com rotação e zoom por mouse ou toque.
- Modos Fotos e Forma, além de ajustes de formato, largura e profundidade salvos por captura.
- Formatos cilíndrico e esférico/oval, além dos perfis automáticos e retangulares.
- Clipping por plano ajustável nos eixos X, Y e Z, com posição e inversão do lado visível.
- Busca, ordenação, renomeação, arquivamento e restauração dos objetos da biblioteca.

## 5. Entrada, processamento e resultado

| Etapa | O que acontece |
| --- | --- |
| Entrada | O usuário informa um nome opcional e fornece as seis fotos do produto. |
| Processamento no servidor | A aplicação recebe as fotos, executa a remoção do fundo e salva imagens e registros. |
| Processamento no navegador | Os contornos das imagens são utilizados para estimar o volume e projetar as fotos sobre ele. |
| Resultado | O produto fica na biblioteca, com imagens sem fundo e visualização 3D aproximada para exploração. |

## 6. Relação com Computação Gráfica

### 6.1. Conceitos efetivamente demonstrados

| Conceito | Aplicação no projeto | Onde conferir |
| --- | --- | --- |
| Processamento de imagens | Preparação e redimensionamento das fotos, segmentação do primeiro plano e recorte do objeto. | `object_background.py` |
| Canal alfa e transparência | A máscara produz uma imagem RGBA, preservando o objeto e tornando o fundo transparente. | `object_background.py` |
| Modelagem geométrica por perfis | Os contornos das quatro vistas laterais estimam largura e profundidade ao longo de uma altura normalizada. Topo e base ajudam a escolher a forma da seção. | `static/js/object-shape.mjs` |
| Malha e triangulação | O sistema calcula vértices em coordenadas X, Y e Z, conecta-os por índices e fecha as superfícies com triângulos. | `static/js/object-shape.mjs` |
| Normais e sombreamento | O visualizador calcula normais dos vértices para a interação da superfície com a iluminação. | `static/js/viewer.js` |
| Texturas e shaders | As seis fotos são projetadas sobre o volume. O shader calcula coordenadas de amostragem e combina as vistas usando normais e valores alfa. | `static/js/viewer.js` |
| Projeção perspectiva | A câmera perspectiva define como a cena 3D aparece na tela 2D. | `static/js/viewer.js` |
| Câmera e interação | Arrastar orbita a câmera ao redor do produto; os controles de zoom aproximam ou afastam a câmera. | `static/js/viewer.js` |
| Transformação de escala | Os controles de largura e profundidade aplicam escala não uniforme nos eixos X e Z do objeto. | `static/js/viewer.js` |
| Iluminação, materiais e sombras | Luz hemisférica, luzes direcionais e material de superfície ajudam a perceber o volume, com renderização WebGL. | `static/js/viewer.js` |
| Clipping por plano | O aplicativo calcula a equação do plano e utiliza o Three.js/WebGL para ocultar os fragmentos do lado descartado. O corte é reversível e acompanha as proporções do objeto. | `static/js/clipping-logic.mjs` e `static/js/viewer.js` |
| Primitivas paramétricas | Os modos cilíndrico e esférico/oval permitem comparar uma seção constante com um volume elipsoidal, preservando a estimativa de proporções. | `static/js/object-shape.mjs` |

A malha padrão utiliza 80 níveis de altura e 80 segmentos por seção, com 6.562 vértices e 12.800 triângulos. Essa resolução descreve a representação geométrica utilizada; não determina a precisão dimensional do objeto real.

O modo cilíndrico utiliza a mesma contagem padrão; o elipsoidal utiliza polos únicos e tem 6.322 vértices e 12.640 triângulos. Esses formatos regularizam a forma por escolha do usuário. O clipping remove partes da exibição e não reconstrói o interior nem cria uma tampa na superfície do corte.

### 6.2. Explicações importantes para a apresentação

- **Rotação na tela:** a interação atual orbita a câmera. Explicar esse movimento como transformação da visualização, mantendo a distinção em relação a girar a própria malha.
- **Zoom:** a aproximação e o afastamento são feitos alterando a distância da câmera ao alvo. O campo de visão da câmera permanece fixo.
- **Vistas Frente, Verso e Topo:** reposicionam a mesma câmera perspectiva. O projeto não utiliza uma câmera ortográfica nesses botões.
- **Texturização:** no volume estimado, as coordenadas para consultar as fotos são calculadas no shader a partir da posição na superfície. As normais ajudam a escolher e combinar as direções de projeção.
- **Modo Forma:** mantém a geometria e a iluminação com uma aparência uniforme, facilitando a observação do contorno e do sombreamento. O modo Fotos apresenta as cores das imagens capturadas.
- **Modelagem aproximada:** os contornos externos orientam a construção do volume. A demonstração deve explicar as limitações em cavidades e medidas físicas.

### 6.3. Componentes tecnológicos de apoio

| Componente existente | Papel no projeto |
| --- | --- |
| HTML, CSS e JavaScript | Interface, orientações de captura, acesso à câmera e interação com os resultados. |
| Python e Flask | Recebimento das imagens, processamento e disponibilização das APIs. |
| U2NETP e ONNX Runtime | Modelo pré-treinado de segmentação executado localmente para separar o primeiro plano. |
| Pillow e NumPy | Preparação e tratamento das imagens. |
| SQLite | Persistência dos registros e dos ajustes das capturas. As imagens ficam em arquivos no servidor. |
| Three.js | Renderização do volume aproximado e controles de rotação e zoom. |
| Socket.IO | Atualizações entre a interface e o servidor. |

A apresentação deve enfatizar os conceitos gráficos e mostrar como esses componentes viabilizam o fluxo completo. A ementa e os critérios específicos do professor ainda precisam ser conferidos, inclusive quanto ao uso de bibliotecas e aos algoritmos que o grupo deve implementar diretamente. A cobertura integral dos conteúdos permanece a confirmar.

Ao explicar o uso de IA, identificar o U2NETP como modelo pré-treinado. A contribuição do projeto inclui sua integração ao fluxo de captura, ao tratamento das imagens, à persistência e à interface.

## 7. Benefícios esperados e avaliação

Os benefícios abaixo são hipóteses de valor para o varejista. Ainda precisam de avaliação com tarefas e produtos definidos.

| Benefício esperado | Como avaliar |
| --- | --- |
| Facilitar a preparação do acervo visual | Medir o tempo entre iniciar a captura e obter o produto salvo. Comparações com o processo manual devem usar a mesma tarefa. |
| Melhorar a consistência das imagens | Conferir objeto inteiro, bordas do recorte, legibilidade do rótulo e presença de fundo ou mãos. |
| Facilitar a localização dos itens | Pedir ao usuário para encontrar uma captura salva e registrar se conclui a tarefa e em quanto tempo. |
| Facilitar a exploração visual | Verificar se o usuário consegue abrir o produto, girar, ampliar e alternar entre Fotos e Forma. |

Registrar o aparelho utilizado, o produto, a iluminação e eventuais falhas. Apresentar resultados medidos, com suas limitações; evitar atribuir ganhos de vendas ou redução de desperdício sem evidências.

## 8. Demonstração do sistema

Usar um produto de embalagem opaca, com iluminação uniforme, para tornar o exemplo fácil de acompanhar.

1. Apresentar o produto e explicar a tarefa do varejista: preparar e organizar seu material visual.
2. Abrir a aplicação no celular pelo link HTTPS ativo e informar um nome para a captura.
3. Iniciar o escaneamento e mostrar as orientações, a contagem e os indicadores das seis vistas.
4. Capturar frente, laterais, verso, topo e base, respeitando a indicação de cada etapa.
5. Aguardar o processamento e conferir as imagens sem fundo.
6. Abrir o resultado, girar e dar zoom. Alternar entre Fotos e Forma para explicar a visualização.
7. Se necessário, demonstrar um ajuste de proporção e seu salvamento.
8. Reabrir o objeto pela biblioteca para evidenciar a persistência dos dados.

Durante a demonstração, fazer a ligação com a disciplina:

- Nas fotos processadas, apontar as bordas do recorte e explicar a máscara alfa.
- Ao abrir o volume, explicar a passagem dos perfis das imagens para vértices e triângulos.
- Ao alternar Fotos e Forma, identificar a contribuição das texturas e do sombreamento.
- Ao arrastar e aproximar, explicar o movimento da câmera e a projeção perspectiva.
- Ao mudar largura ou profundidade, demonstrar a escala aplicada ao objeto.
- Ao ativar o clipping, mover o plano, alternar o eixo e inverter o lado; explicar o teste de distância assinada `n · p + c` e o descarte de fragmentos.
- Demonstrar os perfis cilíndrico e esférico/oval, explicando que são alternativas geométricas aproximadas.
- Renomear uma captura, arquivá-la e restaurá-la para mostrar a preservação dos dados.

O grupo pode mostrar os trechos de código responsáveis pela malha e pelo shader para sustentar a explicação técnica. A interface atual não tem um modo de exibição das arestas dos triângulos.

Na preparação, conferir o funcionamento no aparelho da apresentação. O computador servidor e a conexão precisam permanecer ativos. O endereço temporário deve ser verificado no dia da demonstração.

## 9. Limites que devem ser explicados

- O resultado é uma visualização 3D aproximada pelos contornos, com limitações em cavidades, transparências, reflexos e medidas físicas.
- Mãos junto ao produto e diferenças de enquadramento entre as vistas podem prejudicar o recorte e o formato estimado.
- O escopo apresentado é a captura e a organização visual. Controle de quantidade em estoque, vencimentos, pedidos e vendas não fazem parte do fluxo atual.
- A finalidade do Vitrine 3D é apoiar o acervo visual do varejista. Eventuais resultados comerciais ou ambientais precisam de avaliação específica.

## 10. Roteiro sugerido de slides

| Slide | Conteúdo |
| --- | --- |
| 1 | Empresa do cenário, nome do sistema e integrantes do grupo. |
| 2 | Segmento, perfil do pequeno varejista e usuários envolvidos. |
| 3 | Missão, visão e valores propostos para a empresa. |
| 4 | Problema, processo atual e exemplo que sustenta o diagnóstico. |
| 5 | Objetivo do Vitrine 3D e fluxo gráfico: fotos, máscara alfa, perfis, malha e imagem renderizada. |
| 6 | Computação Gráfica na implementação: vértices, triângulos, primitivas, normais, texturas, perspectiva, escala, iluminação e clipping. |
| 7 | Demonstração ao vivo, relacionando as interações aos conceitos gráficos e reabrindo o resultado pela biblioteca. |
| 8 | Benefícios esperados, forma de avaliação e resultados que tiverem sido medidos. |
| 9 | Limitações, conclusão sobre o problema e próximos passos possíveis. |

Distribuir os tópicos entre os integrantes para que todos participem oralmente. Cada pessoa deve compreender o fluxo completo, além de dominar sua própria parte.

## Pendências para fechar a apresentação

- Validar com o grupo o cenário fictício do Mercado Boa Vizinhança.
- Conferir a ementa de Computação Gráfica e os conteúdos que precisam ser contemplados.
- Preencher os nomes dos integrantes e combinar a divisão da apresentação.
- Selecionar o produto de demonstração e registrar as avaliações realizadas.

Este roteiro descreve o Vitrine 3D V14, incluindo clipping, formatos geométricos e gerenciamento reversível da biblioteca. As fotos e os registros anteriores são preservados.
