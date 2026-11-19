# Vitrine 3D V14 — captura, biblioteca de objetos e clipping

O fluxo começa diretamente no objeto, sem exigir nem iniciar a leitura de códigos de barras. As seis vistas são processadas no próprio computador para gerar PNGs com fundo transparente. O navegador usa os contornos desses recortes para construir uma malha fechada com largura, altura e profundidade, revestida pelas fotos.

Aplicação para Computação Gráfica contextualizada no **Mercado Boa Vizinhança**, um pequeno varejista fictício. O resultado é um volume visual aproximado: não fornece medidas físicas nem recupera o interior real do produto.

## Conteúdo deste repositório

Inclui código, testes, modelo de segmentação local, bibliotecas de visualização com suas licenças, roteiro e PDF revisado da apresentação. Banco de dados, fotos capturadas, logs, credenciais e ambientes locais não são publicados.

Um clone novo começa com a biblioteca vazia. O banco SQLite e a pasta de capturas são criados na primeira execução de `app.py`. As referências a 7 capturas e 78 arquivos nos documentos de revisão registram uma conferência local; esses dados não acompanham o repositório.

O material atual de apresentação tem 10 slides: use o PDF revisado e `ROTEIRO_FALAS_10_SLIDES_VITRINE_3D.md`. Outros prompts e roteiros foram preservados como referências de etapas anteriores do projeto.

## Executar no Windows

Abra o terminal na pasta `scanner3d`:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
```

Se o ambiente já estiver instalado, use apenas o último comando. No PC, abra http://127.0.0.1:5000.

Para executar os testes JavaScript, instale também o Node.js. Ele não é necessário para iniciar o servidor Python.

Para usar a câmera no celular, abra um túnel HTTPS em outro terminal:

```powershell
cloudflared tunnel --url http://127.0.0.1:5000
```

Abra no celular o endereço HTTPS gerado e permita o acesso à câmera. Mantenha o computador e o túnel ativos. Three.js e Socket.IO estão incluídos em `static/vendor/`, nas mesmas versões utilizadas anteriormente. A interface e o processamento local no PC não dependem de CDN ou fontes externas. O link público via Cloudflare continua exigindo internet; a câmera real e o WebGL dependem do aparelho e das permissões do navegador.

### Apresentação pronta

Execute `INICIAR_APRESENTACAO.cmd` para conferir o modelo, o banco e as imagens e iniciar na porta 5002. Acesse http://127.0.0.1:5002 e mantenha a janela aberta. A verificação também pode ser executada separadamente com `.\.venv\Scripts\python.exe verificar_apresentacao.py`; ela não altera o banco.

O PDF revisado está em `output/pdf/Vitrine_3D_revisado.pdf`; o roteiro de fala está em `ROTEIRO_FALAS_10_SLIDES_VITRINE_3D.md`. O guia `APRESENTACAO_FINAL.md` reúne o ensaio, a análise dos slides e o procedimento para o celular.

Se a porta estiver ocupada, inicie em outra porta e aponte o túnel para ela:

```powershell
$env:SCANNER_PORT = '5002'
$env:SCANNER_RELOAD = '1'
.\.venv\Scripts\python.exe app.py
# Em outro terminal:
cloudflared tunnel --url http://127.0.0.1:5002
```

`SCANNER_RELOAD=1` recarrega o servidor após mudanças em arquivos Python, preservando o mesmo túnel enquanto o processo e a porta continuam ativos. O depurador interativo permanece desativado.

## Capturar apenas o objeto

1. Toque em **Escanear agora**. O mesmo comando abre a câmera e inicia a sequência. A preparação inicial dura cerca de meio segundo, e **Capturar agora** aparece imediatamente sobre o vídeo.
2. Apoie o objeto sobre uma superfície, use luz uniforme e mantenha mãos e outros objetos fora do quadrado. Inclua o objeto inteiro, com uma margem ao redor.
3. Siga a sequência: frente, lado direito, verso, lado esquerdo, topo e base. Após cada mudança, mantenha o objeto parado e o celular firme.
4. A captura automática aguarda no mínimo 3 segundos na primeira vista e 4,5 segundos nas demais, contados após a preparação da vista. Exige também 1,1 segundo contínuo de firmeza e luz adequada. Essas esperas podem ocorrer ao mesmo tempo. Movimento, erros de leitura ou pausas do navegador reiniciam o período de estabilidade, dando tempo para enquadrar e para a câmera ajustar o foco. A análise de estabilidade mede movimento; não certifica nitidez óptica. Não há bloqueio por falta de textura nem exigência de detectar uma rotação. **Capturar agora**, sobre o vídeo, fotografa manualmente sem aguardar a análise ou a preparação inicial.
5. Após as seis fotos, aguarde **Separando o objeto do fundo**. A remoção acontece no servidor ao salvar, e não sobre o vídeo ao vivo.
6. Confira os recortes nas miniaturas e explore o volume com mouse ou toque. Arraste para girar livremente; use rolagem, os botões de zoom ou pinça com dois dedos para ampliar.

**Ouvir instruções** anuncia a próxima vista em português quando o navegador oferece síntese de voz. O microfone não é usado. A câmera de vídeo usa resolução preferida de 1280×720 para reduzir a carga de aparelhos móveis, e as fotos do vídeo têm até 1024×1024 pixels.

### Alternativa com a câmera de fotos do Android ou iPhone

Se o vídeo não fornecer fotos, toque em **Usar câmera de fotos do celular**. O app abre a câmera nativa para a primeira vista; depois toque em **Fotografar Direita**, **Fotografar Verso** e assim por diante. Também é possível selecionar uma foto existente. Esta alternativa dispensa a análise contínua do vídeo e preserva a sequência, a remoção do fundo e a visualização final.

A câmera de vídeo é liberada ao usar essa alternativa. Se cancelar a foto e quiser voltar ao vídeo, toque em **Escanear agora**. O app mantém a vista atual. Ao mudar de aplicativo, a análise é pausada e tenta retomar quando a página volta ao primeiro plano. Uma interrupção da câmera apresenta a opção de retomada ou de foto nativa.

Erros temporários de leitura ou codificação de um quadro liberam os botões e reagendam a análise. As operações de rede e imagem têm tempo limite e não dependem de `AbortSignal.timeout` nem `createImageBitmap`.

O seletor **Câmera** permite escolher uma lente mais nítida. O app tenta selecionar a traseira principal pelos nomes disponibilizados pelo aparelho. **Reduzir zoom**, luz e toque para foco dependem dos recursos informados pela câmera. Se o objeto estiver borrado, afaste um pouco antes de aumentar o zoom.

**Cancelar captura** permite refazer as fotos. **Novo objeto** limpa a sequência local para começar outra. Se o envio ou o recorte falhar, as fotos permanecem no navegador para **Reenviar capturas**. Aguarde a conclusão do processamento antes de iniciar outro objeto.

## Remoção do fundo e arquivos

- O modelo U2NETP é executado localmente com ONNX Runtime na CPU. As fotos não são enviadas a um serviço de remoção externo.
- O modelo verificado, suas licenças e a origem do arquivo estão em `models/`. O aplicativo não baixa modelos durante uma captura.
- Os PNGs recortados são salvos em `static/uploads/<id>/<vista>.png`. Os arquivos JPEG originais são preservados como `original-<vista>.jpg`.
- Nome, URLs, data, indicação de fundo removido e ajustes de proporção ficam no SQLite. **Minhas capturas** permite reabrir os objetos após atualizar a página.
- Para capturas antigas, selecione uma na biblioteca e toque em **Remover fundo desta captura**. Os originais são preservados e a captura passa a usar os PNGs transparentes. A migração do banco mantém os registros anteriores.
- O estado do modelo pode ser consultado em `/api/background/status`.

O recorte automático reconhece o primeiro plano visual. Mãos encostadas no objeto, superfícies transparentes, reflexos e fundos muito parecidos com o produto podem exigir uma nova foto. Confira as bordas; manter o objeto apoiado e as mãos fora do enquadramento melhora o resultado.

## Explorar e ajustar a forma

A visualização constrói um volume aproximado pelos contornos de frente, verso e lados. As fotos de topo e base ajudam na escolha entre seção arredondada e retangular e revestem as extremidades. Um pescoço consistente nas vistas laterais também ajuda a reconhecer recipientes arredondados quando o topo contém ruído. As seis imagens são projetadas sobre a malha; a geometria mantém sua espessura ao girar. A amostragem dos contornos usa imagens de até 320 pixels e malha de 80×80, com filtros que reduzem picos sem apagar ombros, pescoços ou paredes retas.

O estúdio tem iluminação mais suave, fundo neutro e uma área maior para o objeto no celular. O enquadramento inicial considera a caixa do objeto no ângulo de apresentação para aproveitar melhor a tela. Ao girar um objeto muito alongado, use o zoom para conferir as extremidades. **Fotos** apresenta as cores capturadas; **Forma** exibe um material uniforme para observar o relevo, o contorno e a espessura. Essa preferência de aparência vale durante a sessão; os ajustes de proporção são salvos por captura.

Em **Ajustar a forma**, escolha **Automático**, **Arredondado**, **Cilíndrico**, **Esférico / oval** ou **Retangular** e refine **Largura** e **Profundidade**. A alteração aparece imediatamente e é salva nesta captura após uma breve pausa. **Restaurar proporções** retorna à estimativa automática. Os controles de perspectiva, frente, verso, topo, centralização, zoom e rotação automática continuam disponíveis.

**Cilíndrico** utiliza seção elíptica constante e tampas planas, adequado para regularizar a aparência de latas e recipientes de laterais retas. **Esférico / oval** utiliza uma superfície elipsoidal com polos, adequada para volumes arredondados. Esses modos são escolhas geométricas explícitas: seguem as proporções estimadas das fotos, sem reconhecer o tipo do produto ou fornecer medidas reais. Para garrafas com pescoço, **Automático** ou **Arredondado** preservam melhor o perfil fotografado.

Capturas transparentes já salvas ganham o volume ao serem reabertas; não é necessário fotografar novamente. Capturas antigas ainda com fundo usam uma caixa ilustrativa até a remoção do fundo.

Este método não é fotogrametria calibrada e não calcula medidas físicas. Seis fotos sem calibração permitem estimar o contorno externo, mas não reconstroem cavidades, alças vazadas ou detalhes finos. Fotos inteiras, alinhadas, com o objeto na mesma posição vertical e sem grandes mudanças de distância melhoram as proporções. Os ajustes manuais corrigem largura e espessura aparentes; não representam precisão dimensional.

## Clipping por plano 3D

Em **Clipping · plano de corte**, ative o corte, escolha **X**, **Y** ou **Z**, mova a posição do plano e use **Inverter lado visível**. Um plano auxiliar indica a região do corte. **Restaurar corte** desliga o efeito. Abrir outro objeto também começa com o clipping desligado.

O aplicativo calcula um plano em coordenadas da cena com equação `n · p + c = 0`. O Three.js/WebGL oculta os fragmentos cuja distância assinada `n · p + c` é negativa. A posição usa a caixa envolvente atual do objeto, acompanhando mudanças de largura, profundidade e formato. O corte afeta a visualização e as sombras do produto; os arquivos, a geometria original e as fotos permanecem salvos.

O plano não gera uma tampa na seção cortada nem recupera o interior físico do produto. O efeito serve para explorar o modelo e demonstrar clipping em Computação Gráfica. Não corresponde a uma implementação de Cohen–Sutherland ou Sutherland–Hodgman. Referência técnica: [clipping de materiais no Three.js](https://threejs.org/docs/pages/Material.html#clippingPlanes).

## Gerenciar a biblioteca

Use **Buscar objetos**, **Ordenar** e **Coleção** para localizar as capturas. Selecione uma para **Salvar nome**, **Arquivar objeto** ou **Restaurar objeto**. O arquivamento é reversível e mantém as imagens, os ajustes e o identificador do registro. A coleção de arquivados permite consultar e restaurar os itens. Não há exclusão permanente nesses controles.

Os controles de gerenciamento aguardam o término de capturas, processamento e salvamentos em andamento. A migração acrescenta apenas a coluna `archived` à tabela `scans`, com os registros existentes ativos por padrão. Os endpoints existentes permanecem disponíveis; `GET /api/scans` lista ativos e `GET /api/scans?archived=1` lista arquivados.

Novos endpoints de gerenciamento: `PATCH /api/scans/<id>` com JSON `{"name":"Nome do objeto"}`, `POST /api/scans/<id>/archive` e `POST /api/scans/<id>/restore`. As atualizações emitem `object_scan_updated` pelo Socket.IO.

## Testes

```powershell
.\.venv\Scripts\python.exe -m unittest -v test_scanner test_object_background test_object_pipeline test_barcode_decoder
node --test --test-timeout=15000 test_scanner.mjs test_camera_logic.mjs test_camera_session.mjs test_capture_runtime.mjs test_viewer_logic.mjs test_object_shape.mjs test_clipping_logic.mjs test_library_logic.mjs test_local_reader.mjs
```

Os testes cobrem captura sem código, sequência de fotos, cancelamento, reenvio, tempo de preparação, troca de câmera, transparência dos PNGs, preservação dos originais, erros de segmentação, migração e processamento de capturas antigas. Há testes do modelo real e de uma captura completa com seis imagens, além das proporções, perfis, fechamento e orientação da malha, remoção de picos no contorno, preservação de ombros e pescoço, enquadramento em telas estreitas e salvamento dos ajustes por captura. A temporização testa movimento reiniciando a estabilidade, pausas entre quadros e espera por cada lado.

Também são testados: captura de objeto simétrico, fotografia manual durante a preparação, recuperação após erro de canvas, seis fotos nativas sem `getUserMedia`, limites de tempo, cancelamento de rede e liberação de URLs temporárias.

Os módulos antigos de leitura de código e seus testes foram preservados para compatibilidade, mas não são iniciados pela interface de captura de objetos. Câmera, foco, luz, voz, renderização WebGL e qualidade do recorte precisam ser conferidos no aparelho e nos objetos utilizados.

## Refinamento visual e preservação do projeto

O acabamento da interface fica em `static/css/polish.css`, carregado após o estilo existente. Essa camada organiza contraste, espaçamentos, foco de teclado, campos, botões, cards e estados visuais. Os links existentes de navegação continuam acessíveis em telas pequenas, com espaço reservado para a área segura do celular. O template também oferece um link para pular ao conteúdo principal e descrições acessíveis para os controles.

O polimento não modifica os arquivos JavaScript, a temporização da captura, a geração do volume, a remoção do fundo, os endpoints ou as integrações. A captura manual, a câmera de fotos do celular, a biblioteca e os ajustes de forma continuam usando os mesmos controles e fluxos.

Na revisão de 14/11/2026, o SQLite foi aberto em modo somente leitura: verificação de integridade sem erros, colunas compatíveis, campos JSON válidos e índices de chave primária presentes. O volume atual não justificou novos índices. Nenhuma tabela, coluna, relação, captura, imagem ou ajuste salvo foi alterado pelo refinamento. A conferência de preservação compara os hashes dos arquivos protegidos e os identificadores dos controles antes e depois das mudanças.

## Componentes de terceiros

As licenças e a procedência do modelo U2NETP ficam em `models/`. As bibliotecas Three.js, Socket.IO e os leitores preservados para compatibilidade incluem licenças e arquivos de procedência em `static/vendor/`. Consulte esses arquivos ao redistribuir os componentes. O grupo integrou o modelo pré-treinado; não realizou seu treinamento.
