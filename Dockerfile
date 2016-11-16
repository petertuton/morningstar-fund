FROM registry.ng.bluemix.net/ibmnode

RUN useradd --user-group --create-home --shell /bin/false app &&\
  npm install --global npm@3.7.5

ENV HOME=/home/app

COPY package.json $HOME/morningstar-fund/
RUN chown -R app:app $HOME/*

USER app
WORKDIR $HOME/morningstar-fund
RUN npm install

USER root
COPY app.js $HOME/morningstar-fund
RUN chown -R app:app $HOME/*
USER app

ENTRYPOINT ["node", "app.js"]
