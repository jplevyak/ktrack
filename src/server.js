import sirv from 'sirv';
import polka from 'polka';
import bodyParser from 'body-parser';
import compression from 'compression';
import * as sapper from '@sapper/server';

const { PORT, NODE_ENV } = process.env;
const dev = NODE_ENV === 'development';

polka() // You can also use Express
  .use(bodyParser.json({ limit: '10mb' }))
	.use(
		compression({ threshold: 256 }),
		sirv('static', { dev }),
    sapper.middleware({
      session: (req, res) => ({
        user: req.user
      }
      )
    }))
  .listen(PORT, err => {
    if (err) console.log('error', err);
  });
