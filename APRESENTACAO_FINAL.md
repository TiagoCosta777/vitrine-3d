# Vitrine 3D — preparação final para apresentar

## Material pronto

- Slides: `output/pdf/Vitrine_3D_revisado.pdf` — 10 páginas, revisadas e renderizadas para conferência.
- Falas: `ROTEIRO_FALAS_10_SLIDES_VITRINE_3D.md` — nomes do grupo, explicação técnica no slide 8 e passos da demonstração no 9.
- Aplicativo: executar `INICIAR_APRESENTACAO.cmd` e abrir `http://127.0.0.1:5002`.

A cópia PDF é independente do original em Downloads e da fonte editável no Gamma. Se for apresentar diretamente pelo Gamma, leve para lá os mesmos ajustes; se apresentar o PDF revisado, eles já estão aplicados.

## O que a análise dos slides confirmou

| Slides | Coerência e acabamento final |
| --- | --- |
| 1–2 | Nome Vitrine 3D, cinco integrantes, pequeno varejo, clientes e operadores distintos. Acrescentadas disciplina e identificação da empresa fictícia; alinhamento do texto e valores melhorados. |
| 3–4 | Problemas são hipóteses do caso, não pesquisa de campo. Captura guiada, recortes, biblioteca e exploração correspondem ao app. Tabela ampliada. |
| 5 | Frente, direita, verso, esquerda, topo e base correspondem à sequência do aplicativo. Imagem identificada como ilustração. |
| 6 | Buscar, ordenar, reabrir, renomear, arquivar e restaurar existem. Arquivar não apaga imagens nem cria outro registro ao restaurar. |
| 7 | Fotos/Forma, aproximação, formatos e ajustes de largura/profundidade existem. Texto ampliado e limite de ausência de medidas preservado. |
| 8 | Único slide técnico, com 53 palavras. Imagens PNG/JPEG em arquivos; SQLite para nomes, caminhos e ajustes. Three.js/WebGL para exibição e clipping; Socket.IO para atualizações. |
| 9 | As ações da demonstração estão disponíveis. A ilustração não é tela real nem comprovação de captura. A instrução de alternar para o app e o plano para uma falha foram movidos para o roteiro. |
| 10 | Comparação funcional correta e tabela ampliada. Indicadores continuam “a medir”; sem resultados comerciais inventados. |

## Antes de sair para apresentar

1. Abra o PDF revisado e deixe o slide 9 acessível para a troca ao aplicativo.
2. Execute o atalho de inicialização. Ele confere modelo, bibliotecas, integridade do banco e existência das imagens, sem alterar os registros. Se a porta 5002 estiver ocupada por outra instância, use a instância existente ou escolha outra porta conforme README; não encerre processos desconhecidos.
3. No navegador do PC, abra o endereço local e recarregue a página para pegar o acabamento atualizado.
4. Escolha uma embalagem opaca, sem brilho forte, e um fundo simples de cor diferente. Evite usar um frasco transparente como exemplo principal de precisão.
5. Faça uma captura real de ensaio e confira as seis bordas. Dê um nome reconhecível para reencontrá-la na biblioteca. Mantenha essa captura como apoio declarado caso a captura ao vivo não termine.
6. Teste a câmera no aparelho real. Os testes automatizados usaram câmera sintética e tamanhos de tela móveis; não substituem conferir permissões, foco e qualidade no Android/iPhone da apresentação.
7. Mantenha computador e servidor ligados. O exemplo desenhado inicialmente no estúdio é identificado como demonstração; não o apresente como resultado de uma captura real.

## Celular

Para usar a câmera no celular pelo link público, inicie o aplicativo e, em outro terminal, execute:

```powershell
cloudflared tunnel --url http://127.0.0.1:5002
```

Abra o novo endereço HTTPS exibido pelo Cloudflare. Links temporários antigos podem expirar. O túnel exige internet e deixa o aplicativo e suas imagens acessíveis a quem tiver o endereço enquanto estiver ativo. Essa é a mesma forma de acesso público já utilizada no projeto.

Se a câmera de vídeo não colaborar, use **Capturar agora** ou **Usar câmera de fotos do celular**. Não tente concluir uma apresentação insistindo num aparelho sem foco: informe a ocorrência e abra a captura real preparada no ensaio.

## Demonstração do slide 9

1. Nomear e capturar seis vistas.
2. Aguardar a remoção do fundo e conferir os recortes.
3. Arrastar, aproximar e alternar Fotos/Forma.
4. Ajustar formato e proporções. Centralizar se necessário. Para garrafas com pescoço, manter Automático/Arredondado.
5. Ativar clipping, escolher eixo, mover, inverter e restaurar. Dizer que o corte não revela o interior físico.
6. Reabrir pela biblioteca, renomear, buscar, ordenar, arquivar e restaurar.

## Respostas curtas para perguntas

- **É um escâner 3D métrico?** Não. É uma estimativa do exterior pelos contornos de seis imagens, com ajustes visuais de proporção.
- **O grupo treinou uma IA?** Não. Integramos um modelo pré-treinado de segmentação e desenvolvemos a aplicação e a lógica de volume.
- **Onde estão as fotos?** Em arquivos locais; SQLite registra nomes, caminhos e ajustes.
- **O clipping mostra o interior real?** Não. Oculta um lado do plano na visualização, sem alterar os arquivos e sem gerar uma tampa na seção.
- **Precisa de internet?** A visualização e o processamento no PC usam os arquivos locais. O acesso público pelo Cloudflare exige internet. A câmera precisa de contexto seguro e permissões.
- **Já houve aumento de vendas ou redução de tempo?** Não medimos esses efeitos. A apresentação demonstra funcionalidades; a avaliação com usuários é o próximo passo.

## Preservação e verificação

O banco original continuou íntegro com 7 capturas e 78 arquivos de imagem preservados. A captura, segmentação, geração do volume e regras da biblioteca não foram reescritas. No JavaScript do aplicativo, a única mudança foi a mensagem de falha de carregamento, que agora se refere ao WebGL e ao servidor, em vez de exigir internet para bibliotecas já locais.

Os testes de navegador usam cópia isolada do banco, câmera sintética e bloqueiam pedidos externos. Cobrem a visualização, formas, clipping, renomeação, arquivamento/restauração e larguras de 1440, 820 e 390 pixels. Evidências técnicas ficam em `.qa/presentation-browser/`; essa pasta não é necessária para executar o aplicativo.
