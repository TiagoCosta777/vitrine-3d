# Roteiro de falas — Vitrine 3D (10 slides)

Roteiro alinhado à cópia revisada em `output/pdf/Vitrine_3D_revisado.pdf`, com 10 slides. O Mercado Boa Vizinhança é uma empresa fictícia. A explicação técnica está somente no slide 8; o aprofundamento serve para consulta e perguntas. O nome do professor não foi informado.

Integrantes, conforme a capa fornecida: Tiago Costa Pereira; Lyvia Batista Vieira Vilela; Gustavo Henrique Lopes; Sergio Alves Rodrigues Júnior; Nicole Campos Da Fonseca.

Sugestão de divisão, ajustável pelo grupo: Tiago (1–2), Lyvia (3–4), Gustavo (5–6), Sergio (7–8) e Nicole (9–10). Ensaiem também as perguntas sobre o fluxo completo. A demonstração usa o programa real; as imagens ilustrativas dos slides não são resultados do aplicativo.

## Slide 1 — Vitrine 3D e Mercado Boa Vizinhança

Fala principal: “Nosso caso é o Mercado Boa Vizinhança, um pequeno varejista fictício. A proposta do Vitrine 3D é apoiar uma tarefa concreta da equipe: preparar, guardar e consultar o material visual dos produtos.”

## Slide 2 — Mercado Boa Vizinhança

Fala principal: “O mercado atende moradores do bairro nas compras do dia a dia. Quem opera o Vitrine 3D é o proprietário ou o funcionário responsável pelas imagens. A missão do mercado destaca atendimento próximo e informações claras; a visão busca confiança no bairro e qualidade na apresentação dos produtos. Os valores se traduzem em imagens claras, proximidade com a rotina da equipe, capturas organizadas e tecnologia útil. É esse trabalho interno de preparação e consulta que o projeto atende.”

Identidade completa do mercado fictício: Missão — facilitar as compras do dia a dia com atendimento próximo e informações claras sobre os produtos. Visão — ser reconhecido no bairro pela confiança no atendimento e pela qualidade da apresentação dos produtos, inclusive no ambiente digital. Valores — transparência, proximidade, organização e inovação útil.

## Slide 3 — O cenário anterior dificultava a consulta

Fala principal: “No cenário que propusemos, as fotos não seguem uma apresentação consistente e os arquivos ficam espalhados. Isso dificulta preparar o material e reencontrar um produto. São os problemas escolhidos para orientar o projeto, e não resultados de uma pesquisa realizada com uma empresa real.”

## Slide 4 — A solução conecta cada problema a uma ação simples

Fala principal: “O Vitrine 3D reúne recursos já disponíveis no aplicativo. A equipe registra o produto, confere as imagens sem fundo, guarda a captura e pode reabri-la para explorar diferentes lados. A solução organiza esse percurso de trabalho em um só lugar.”

## Slide 5 — Seis vistas orientam a captura e a conferência

Fala principal: “A captura orienta a equipe pelas seis vistas e o aplicativo entrega as imagens com o fundo removido. Isso ajuda a preparar uma apresentação mais consistente, mas a conferência continua necessária. Mãos, reflexos e fundos parecidos com o produto podem exigir uma nova foto.”

## Slide 6 — Uma biblioteca transforma registros em material reutilizável

Fala principal: “Depois de registrar o produto, a equipe pode encontrá-lo novamente pela biblioteca e abrir a captura salva. Também pode ajustar o nome, ordenar os registros e retirar temporariamente um item da coleção ativa. O arquivamento é reversível: restaurar traz a mesma captura de volta.”

## Slide 7 — A exploração combina ângulos, formatos e ajustes visuais

Fala principal: “A captura pode ser explorada de vários lados e ampliada para observar sua apresentação. Os modos Fotos e Forma ajudam a comparar a aparência, e os ajustes permitem corrigir proporções visuais. O resultado é uma aproximação do exterior do produto; esses controles não fornecem medidas reais.”

## Slide 8 — Como foi feito: tecnologias e lógica

Fala principal: “O fluxo tem quatro etapas: capturar, processar, guardar e exibir. JavaScript, as APIs de câmera e o Canvas registram as seis vistas. A API em Python com Flask recebe as imagens; Pillow e NumPy participam do tratamento, e o modelo pré-treinado U2NETP gera a máscara de recorte, executado pelo ONNX Runtime na CPU do computador. As fotos PNG e JPEG ficam em arquivos; o SQLite guarda nomes, caminhos e ajustes. Nossa lógica estima perfis pelos contornos e monta uma malha de vértices e triângulos. Three.js e WebGL exibem o volume aproximado com as cores das fotos, iluminação e controles de câmera. O clipping usa um plano para ocultar uma parte da visualização, sem recuperar o interior físico. Socket.IO comunica mudanças às interfaces conectadas. O grupo desenvolveu a aplicação, a integração e a lógica de volume; não treinou o modelo nem criou a biblioteca gráfica.”

Aprofundamento técnico — somente para consulta e perguntas:
Capturar: HTML e CSS organizam a interface; JavaScript, APIs de câmera e Canvas registram seis vistas. A lógica observa luz e movimento. A captura automática exige tempo mínimo de 3 s na primeira vista e 4,5 s nas demais, mais 1,1 s contínuo de estabilidade. As condições podem ocorrer simultaneamente; não some os tempos como espera fixa. Movimento, iluminação inadequada e interrupções reiniciam a estabilidade. A análise não certifica nitidez óptica. Há captura manual e alternativa pela câmera de fotos do celular.
Recortar: Python/Flask recebe e valida; Pillow e NumPy preparam os dados. U2NETP, pré-treinado e integrado pelo grupo, roda via ONNX Runtime na CPU do servidor local. Uma máscara separa o produto; o canal alfa dá transparência aos PNGs. Cópias JPEG anteriores ao recorte são preservadas. As fotos não vão a serviço externo; o grupo não treinou o modelo. A transparência pertence aos recortes; o material do volume é opaco.
Guardar: imagens ficam em static/uploads/. SQLite guarda registros, nomes, caminhos e ajustes, não binários. A biblioteca consulta esses registros. Renomear, arquivar e restaurar atualizam o mesmo item; Flask-SocketIO/Socket.IO comunica atualizações. Não é integração de vendas nem publicação de catálogo.
Exibir: lógica própria estima perfis de largura e profundidade pelos contornos, suaviza pequenos picos e cria seções com vértices e triângulos para fechar uma malha. Topo e base ajudam na seção e nas texturas das extremidades. Three.js recebe a geometria, calcula normais e usa WebGL. Cilíndrico usa seção elíptica constante e tampas; Esférico / oval usa superfície elipsoidal. São opções explícitas, sem reconhecer produto ou medir fisicamente. Fotos fornecem cores por projeção; o volume vem dos perfis. onBeforeCompile combina vistas usando direções da superfície e alfa. Fotos mostra cores capturadas; Forma usa aparência uniforme.
Interação: câmera perspectiva; arrastar orbita, zoom muda distância mantendo o campo de visão. Frente, Verso e Topo reposicionam a mesma câmera, sem projeções ortográficas. Largura e profundidade mudam a escala visual. Luz e sombras ajudam a perceber forma.
Clipping: calcula plano n·p+c=0 por eixo, posição e caixa envolvente. Three.js/WebGL oculta fragmentos por distância assinada; inverter troca o lado. Começa desligado, é reversível e acompanha o formato. Afeta exibição e sombras, sem alterar arquivos, revelar interior físico ou tampar a seção. Não usar Cohen–Sutherland nem Sutherland–Hodgman.
Pseudocódigo — simplificação didática: “capturar seis vistas válidas; gerar e conferir máscaras; preservar originais e salvar recortes/registros; estimar perfis e gerar volume; aplicar fotos e controles de visualização”.
Contribuição e limites: distinguir aplicação e lógicas próprias de bibliotecas e modelo integrado. Não é treinamento de IA 3D, fotogrametria calibrada ou reconstrução métrica. Referências: app.py; object_background.py; static/js/app.js; static/js/scan-logic.mjs; static/js/object-shape.mjs; static/js/viewer.js; static/js/clipping-logic.mjs.

## Slide 9 — Demonstração ao vivo: do registro à reutilização

Fala principal: “Vamos acompanhar uma embalagem no aplicativo e verificar o que a equipe consegue fazer. A captura começa diretamente pelo objeto; não precisamos ler um código de barras.”

Sequência de demonstração:

1. Mostrar uma embalagem opaca, com fundo simples e iluminação uniforme. Preencher um nome e iniciar **Escanear objeto**.
2. Capturar frente, direita, verso, esquerda, topo e base. Se necessário, usar **Capturar agora** ou a alternativa **Usar câmera de fotos do celular**.
3. Aguardar o processamento, conferir as bordas e observar o volume. Arrastar, aproximar e alternar **Fotos / Forma**.
4. Experimentar **Cilíndrico** numa embalagem de paredes retas ou **Esférico / oval** quando adequado. Para garrafas com pescoço, preferir **Automático** ou **Arredondado**. Usar **Centralizar produto** se precisar reenquadrar.
5. Ativar o plano de corte, escolher um eixo, mover a posição, inverter o lado e restaurar. Dizer: “O corte muda somente a visualização; não revela o interior real do produto.”
6. Reabrir a captura pela biblioteca; renomear, buscar, ordenar, arquivar e restaurar. Confirmar que o mesmo objeto retorna à coleção ativa.

Explicar as ações e a utilidade, sem abrir uma segunda explicação de implementação. Ensaiar no computador e no celular que serão usados. Se a captura falhar, informar a ocorrência e usar uma captura real preparada antes, identificando-a; não simular sucesso. O exemplo inicial do estúdio é ilustrativo, e não conta como captura real.

## Slide 10 — Uma proposta para preparar, organizar e explorar imagens

Fala principal: “O Vitrine 3D responde ao cenário com recursos que podemos demonstrar: preparar as imagens, organizar as capturas e explorar visualmente o exterior do produto. A tabela relaciona cada dificuldade à resposta disponível. O volume continua sendo aproximado e não fornece medidas reais. O próximo passo é testar as tarefas com usuários, observando as bordas dos recortes, o reencontro de uma captura e a conclusão do trabalho. Esses indicadores ainda estão a medir; não apresentamos ganhos de vendas ou produtividade como resultados comprovados.”

Apoio para perguntas: o resultado depende das fotos e não reproduz com fidelidade cavidades, reflexos ou transparências. A solução não inclui estoque/validade, pedidos, vendas, WhatsApp, publicação automática de catálogo ou exportação dedicada. Não alegar redução de desperdício. Os próximos passos são propostas, não tarefas concluídas. Conferir os critérios específicos da professora; a ementa completa não foi fornecida.

