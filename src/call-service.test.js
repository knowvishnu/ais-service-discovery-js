'use strict';

const ServiceDiscovery = require('./call-service');
const { LambdaAdapter } = require('./functions');
const { CloudmapAdapter } = require('./services');
const { SQS } = require('./queue');
const { SNS } = require('./events');
const { StepFunctionAdapter } = require('./state-machine');
const { SSMAdapter } = require('./automation');
const { extractServiceParts } = require('./helpers/call-service-helper');

describe('(call)', () => {
  beforeAll(() => {
    process.env.STAGE = 'latest';
  });

  afterEach(() => {
    jest.resetAllMocks();
    jest.resetModules();
  });

  const lambdaService = {
    Instances: [{
      Id: 'my-func',
      Attributes: {
        type: 'function',
        arn: 'my-test-arn',
      },
    }, {
      Id: 'nope',
      Attributes: {
        type: 'function',
        arn: 'ExampleArn',
      },
    }],
  };

  const stateMachineService = {
    Instances: [{
      Id: 'state-machine',
      Attributes: {
        type: 'state-machine',
        arn: 'my-test-arn',
      },
    }],
  };

  const automationService = {
    Instances: [{
      Id: 'other',
      Attributes: {
        type: 'something-else',
        arn: 'ExampleArn',
      },
    }, {
      Id: 'test',
      Attributes: {
        type: 'automation',
        arn: 'ExampleDocumentName',
      },
    }],
  };

  const snsService = {
    Instances: [{
      Id: 'test-topic',
      Attributes: {
        type: 'sns',
        arn: 'test-topic',
      },
    }],
  };

  const sqsService = {
    Instances: [{
      Id: 'sqs',
      Attributes: {
        type: 'queue',
        url: 'test-queue',
      },
    }],
  };

  it('should call a lambda function', async () => {
    const expected = { name: 'test' };
    CloudmapAdapter.prototype.discover = jest.fn().mockReturnValue(Promise.resolve(lambdaService));
    LambdaAdapter.prototype.call = jest.fn().mockImplementation(() => Promise.resolve(expected));
    expect.assertions(1);
    const body = { name: 'Ewan' };
    const res = await ServiceDiscovery.call({
      service: 'test-service',
      handler: 'my-func',
      body,
    });
    expect(res).toEqual(expected);
  });

  it('should call a lambda using a service id', async () => {
    const expected = { name: 'test' };
    CloudmapAdapter.prototype.discover = jest.fn().mockReturnValue(Promise.resolve(lambdaService));
    LambdaAdapter.prototype.call = jest.fn().mockImplementation(() => Promise.resolve(expected));
    expect.assertions(1);
    const body = { name: 'Ewan' };
    const res = await ServiceDiscovery.request('test-service->my-func', body);
    expect(res).toEqual(expected);
  });

  it('should publish an sns event', async () => {
    const messageId = 'abc123';
    CloudmapAdapter.prototype.discover = jest.fn().mockReturnValue(Promise.resolve(snsService));
    SNS.prototype.publish = jest.fn().mockImplementation(() => Promise.resolve({
      MessageId: messageId,
    }));

    expect.assertions(2);

    const event = { name: 'Test' };
    const res = await ServiceDiscovery.publish('test-namespace.test-topic', event);
    expect(SNS.prototype.publish).toBeCalledWith('test-topic', event);
    expect(res).toEqual({ MessageId: messageId });
  });

  it('should send an sqs message', async () => {
    expect.assertions(5);
    const namespace = 'test-namespace';
    const queue = 'test-queue';
    const namespaceQueue = `${namespace}.${queue}`;
    const message = { name: 'test' };
    const mockMessageId = 'abc123';
    const opts = { MessageGroupId: 'abc123', MessageDeduplicationId: 'abc123' };

    CloudmapAdapter.prototype.discover = jest.fn().mockReturnValue(Promise.resolve(sqsService));
    SQS.prototype.send = jest.fn().mockImplementation(() => Promise.resolve({
      MessageId: mockMessageId,
    }));

    const { MessageId } = await ServiceDiscovery.queue(namespaceQueue, message, opts);
    expect(SQS.prototype.send).toBeCalledWith(queue, message, opts);
    expect(MessageId).toEqual(mockMessageId);

    const mockDelete = jest.fn();

    CloudmapAdapter.prototype.discover = jest.fn().mockReturnValue(Promise.resolve(sqsService));
    SQS.prototype.listen = jest.fn().mockImplementation(() => Promise.resolve({
      message,
      delete: mockDelete,
    }));

    const messages = await ServiceDiscovery.listen('test-namespace.test-queue');
    messages.on('message', (msg) => {
      msg.delete();
      expect(message).toEqual(msg.message);
      expect(mockDelete).toHaveBeenCalled();
      messages.stop();
    });

    expect(SQS.prototype.listen).toBeCalledWith('test-queue');
  });

  it('should use the specified namespace if included in service name', async () => {
    expect.assertions(1);

    const serviceWithNamespace = 'my-namespace.service-name';

    expect(extractServiceParts(serviceWithNamespace))
      .toEqual({
        namespace: 'my-namespace',
        service: 'service-name',
      });
  });

  it('should use the default namespace if not included in service name', async () => {
    expect.assertions(1);

    const defaultNamespaceVal = 'default';
    const serviceWithoutNamespace = 'service-name';

    expect(extractServiceParts(serviceWithoutNamespace))
      .toEqual({
        namespace: defaultNamespaceVal,
        service: 'service-name',
      });
  });

  it('should start a state machine', async (done) => {
    const expected = { name: 'testing' };
    CloudmapAdapter.prototype.discover = jest.fn()
      .mockReturnValue(Promise.resolve(stateMachineService));
    StepFunctionAdapter.prototype.start = jest.fn().mockReturnValue(Promise.resolve(expected));
    const body = { name: 'test', tenant: 'mock' };

    const result = await ServiceDiscovery.call({
      service: 'test-service',
      handler: 'test',
      body,
    });

    expect(result).toEqual(expected);
    done();
  });

  it('should run an automation task', async (done) => {
    const expected = { name: 'testing' };
    CloudmapAdapter.prototype.discover = jest.fn()
      .mockReturnValue(Promise.resolve(automationService));
    SSMAdapter.prototype.run = jest.fn().mockReturnValue(Promise.resolve(expected));
    const body = { name: 'test', tenant: 'mock' };

    const result = await ServiceDiscovery.call({
      service: 'test-service',
      handler: 'test',
      body,
    });

    expect(result).toEqual(expected);
    done();
  });
});
